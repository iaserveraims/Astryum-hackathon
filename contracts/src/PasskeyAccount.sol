// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/**
 * @title PasskeyAccount — the demo-grade P256 door (BuildSpec §2.3, Z15)
 *
 * @notice The exchange client's account on Flare: controlled by ONE WebAuthn
 * passkey (secp256r1), verified on-chain through the RIP-7212 precompile at
 * 0x…0100 — probed LIVE on Flare mainnet (positive + negative
 * vector, ~3450 gas). The Flare-native PersonalAccount is OnlyController
 * (XRPL-commanded only), so the passkey door lives in this contract.
 *
 * Scope, stated plainly (Z15): this is the DEMO account — it proves the
 * scene-5 circuit (deposit lands here in mode B; the holder's Face ID signs
 * the exit; nobody else can). The PRODUCT account adds what this one
 * deliberately lacks: multi-device keys and delayed, veto-able recovery —
 * post-freeze work with its trust residual declared (Orden §3.1).
 *
 * How a call is authorized (WebAuthn assertion, bound to THIS account):
 *   challenge = keccak256(chainid ‖ account ‖ nonce ‖ target ‖ value ‖ data)
 *   clientDataJSON = pre ‖ base64url(challenge) ‖ post   (reconstructed HERE)
 *   message = sha256(authenticatorData ‖ sha256(clientDataJSON))
 *   P256VERIFY(message, r, s, PUBKEY_X, PUBKEY_Y) must return 1
 * The nonce makes every challenge single-use; chainid+address kill cross-
 * context replay. Demo-grade caveat, on the record: the challenge is bound by
 * RECONSTRUCTION (the signed JSON provably contains our challenge between the
 * caller-supplied pre/post), not by field-position parsing — the production
 * account should parse the `challenge` member per webauthn-sol practice.
 */
contract PasskeyAccount {
    /// @notice RIP-7212 P256VERIFY precompile (live on Flare, chain 14).
    address public constant P256_VERIFIER = 0x0000000000000000000000000000000000000100;

    uint256 public immutable PUBKEY_X;
    uint256 public immutable PUBKEY_Y;

    /// @notice Single-use challenge counter — every signature authorizes ONE call.
    uint256 public nonce;

    struct WebAuthnSig {
        bytes authenticatorData; // ≥37 bytes; flags byte must carry User Present
        string clientDataPre; // '{"type":"webauthn.get","challenge":"'
        string clientDataPost; // '","origin":…}'
        bytes32 r;
        bytes32 s;
    }

    /// One leg of a batch: a single call the account will make.
    struct Call {
        address target;
        uint256 value;
        bytes data;
    }

    event Executed(address indexed target, uint256 value, bytes4 selector, uint256 nonce);
    event BatchExecuted(uint256 indexed count, uint256 nonce);

    error InvalidPasskeySignature();
    error MalformedAuthenticatorData();
    error ZeroKey();
    error EmptyBatch();

    constructor(uint256 pubKeyX, uint256 pubKeyY) {
        if (pubKeyX == 0 || pubKeyY == 0) revert ZeroKey();
        PUBKEY_X = pubKeyX;
        PUBKEY_Y = pubKeyY;
    }

    receive() external payable {}

    /// @notice The exact challenge the passkey must sign to authorize a call.
    /// The wallet UI feeds this (as the WebAuthn challenge) to the platform
    /// authenticator — for the user it is one Face ID prompt.
    function challengeFor(address target, uint256 value, bytes calldata data) public view returns (bytes32) {
        return keccak256(abi.encode(block.chainid, address(this), nonce, target, value, data));
    }

    /// @notice The clientDataJSON this account reconstructs and hashes — public
    /// so tests and the wallet UI compute byte-identical messages.
    function clientDataJSON(bytes32 challenge, string calldata pre, string calldata post)
        public
        pure
        returns (bytes memory)
    {
        return abi.encodePacked(pre, _base64url(challenge), post);
    }

    /// @notice The challenge for a BATCH — one Face ID authorizes every leg.
    /// A deposit (approve + deposit), a redeem, or an external transfer all
    /// become a single signature the user reviews once.
    function challengeForBatch(Call[] calldata calls) public view returns (bytes32) {
        return keccak256(abi.encode(block.chainid, address(this), nonce, calls));
    }

    /// @notice Execute ONE call, authorized by the passkey. Anyone may carry
    /// the transaction (a relayer, the operator's UI, the user's browser) —
    /// the AUTHORITY is the P256 signature, and only the key holder has it.
    function execute(address target, uint256 value, bytes calldata data, WebAuthnSig calldata sig)
        external
        returns (bytes memory)
    {
        uint256 usedNonce = _verifyAndConsume(challengeFor(target, value, data), sig);
        bytes memory ret = _doCall(target, value, data);
        emit Executed(target, value, data.length >= 4 ? bytes4(data) : bytes4(0), usedNonce);
        return ret;
    }

    /// @notice Execute a BATCH of calls under ONE passkey signature — the
    /// universal action path for the user (deposit = approve + deposit; redeem;
    /// send to an external wallet). Atomic: any leg that reverts reverts all.
    function executeBatch(Call[] calldata calls, WebAuthnSig calldata sig) external returns (bytes[] memory rets) {
        if (calls.length == 0) revert EmptyBatch();
        uint256 usedNonce = _verifyAndConsume(challengeForBatch(calls), sig);
        rets = new bytes[](calls.length);
        for (uint256 i = 0; i < calls.length; i++) {
            rets[i] = _doCall(calls[i].target, calls[i].value, calls[i].data);
        }
        emit BatchExecuted(calls.length, usedNonce);
    }

    /// The one place the WebAuthn assertion is checked and the nonce burned.
    /// `challenge` already commits chainid + this account + the current nonce +
    /// the exact call(s), so it is single-use and context-bound.
    function _verifyAndConsume(bytes32 challenge, WebAuthnSig calldata sig) internal returns (uint256 usedNonce) {
        // authenticatorData: 32-byte rpIdHash ‖ flags ‖ 4-byte counter — and
        // the User-Present bit must be set (a human touched the authenticator).
        if (sig.authenticatorData.length < 37 || (uint8(sig.authenticatorData[32]) & 0x01) != 0x01) {
            revert MalformedAuthenticatorData();
        }
        bytes memory cdj = abi.encodePacked(sig.clientDataPre, _base64url(challenge), sig.clientDataPost);
        bytes32 message = sha256(abi.encodePacked(sig.authenticatorData, sha256(cdj)));

        (bool ok, bytes memory out) =
            P256_VERIFIER.staticcall(abi.encodePacked(message, sig.r, sig.s, PUBKEY_X, PUBKEY_Y));
        // RIP-7212: 32-byte word 1 on a valid signature; EMPTY output otherwise.
        if (!ok || out.length != 32 || bytes32(out) != bytes32(uint256(1))) {
            revert InvalidPasskeySignature();
        }
        usedNonce = nonce;
        nonce = usedNonce + 1;
    }

    function _doCall(address target, uint256 value, bytes memory data) internal returns (bytes memory) {
        (bool success, bytes memory ret) = target.call{value: value}(data);
        if (!success) {
            assembly {
                revert(add(ret, 32), mload(ret))
            }
        }
        return ret;
    }

    // ── base64url of a 32-byte word (43 chars, no padding — WebAuthn style) ──

    bytes internal constant B64URL = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

    function _base64url(bytes32 input) internal pure returns (bytes memory out) {
        out = new bytes(43);
        uint256 bits = 0;
        uint256 bitCount = 0;
        uint256 idx = 0;
        for (uint256 i = 0; i < 32; i++) {
            bits = (bits << 8) | uint8(input[i]);
            bitCount += 8;
            while (bitCount >= 6) {
                bitCount -= 6;
                out[idx++] = B64URL[(bits >> bitCount) & 0x3F];
            }
        }
        // 256 bits = 42 full sextets + 4 remaining bits, padded with two zeros.
        out[idx] = B64URL[(bits << (6 - bitCount)) & 0x3F];
    }
}

/**
 * @title PasskeyAccountFactory — counterfactual client accounts (Orden §3.1)
 *
 * @notice Onboarding N clients writes NOTHING on chain: the account address
 * derives from the passkey's public key (CREATE2), the operator deposits to
 * it in mode B (`receiver` = predicted address), and the contract deploys
 * lazily on first use — typically inside the client's own first exit tx.
 * The factory keeps no power and has no owner.
 */
contract PasskeyAccountFactory {
    event AccountCreated(address indexed account, uint256 indexed pubKeyX, uint256 pubKeyY);

    function salt(uint256 pubKeyX, uint256 pubKeyY) public pure returns (bytes32) {
        return keccak256(abi.encode(pubKeyX, pubKeyY));
    }

    /// @notice Where this passkey's account lives — before it exists.
    function accountFor(uint256 pubKeyX, uint256 pubKeyY) public view returns (address predicted, bool deployed) {
        bytes32 initHash =
            keccak256(abi.encodePacked(type(PasskeyAccount).creationCode, abi.encode(pubKeyX, pubKeyY)));
        predicted = address(
            uint160(uint256(keccak256(abi.encodePacked(bytes1(0xff), address(this), salt(pubKeyX, pubKeyY), initHash))))
        );
        deployed = predicted.code.length > 0;
    }

    /// @notice Deploy the account (idempotent — returns the existing one).
    function create(uint256 pubKeyX, uint256 pubKeyY) external returns (address account) {
        (address predicted, bool deployed) = accountFor(pubKeyX, pubKeyY);
        if (deployed) return predicted;
        account = address(new PasskeyAccount{salt: salt(pubKeyX, pubKeyY)}(pubKeyX, pubKeyY));
        emit AccountCreated(account, pubKeyX, pubKeyY);
    }
}
