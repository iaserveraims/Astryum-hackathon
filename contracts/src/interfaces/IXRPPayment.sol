// SPDX-License-Identifier: MIT
pragma solidity >=0.7.6 <0.9;

// VENDORED verbatim from the flare-periphery-contracts npm package (scope
// "flarenetwork"), where the coston2/ and flare/ copies are byte-identical
// (diffed 2026-07-16). Vendored so contracts/ builds self-contained, without a
// remapping into node_modules.

/**
 * @custom:name IXRPPayment
 * @custom:id 0x08
 * @custom:supported XRP, testXRP
 * @author Flare
 * @notice A relay of a transaction on an XRPL chain that is of type payment in a
 * native (XRP) currency, identified by its `transactionId`.
 */
interface IXRPPayment {
    struct Request {
        bytes32 attestationType;
        bytes32 sourceId;
        bytes32 messageIntegrityCode;
        RequestBody requestBody;
    }

    struct Response {
        bytes32 attestationType;
        bytes32 sourceId;
        uint64 votingRound;
        uint64 lowestUsedTimestamp;
        RequestBody requestBody;
        ResponseBody responseBody;
    }

    struct Proof {
        bytes32[] merkleProof;
        Response data;
    }

    /**
     * @param transactionId ID of the payment transaction.
     * @param proofOwner Address authorized to use the proof, where applicable.
     */
    struct RequestBody {
        bytes32 transactionId;
        address proofOwner;
    }

    /**
     * @param sourceAddressHash Standard address hash of the source address.
     * @param firstMemoData Raw bytes of MemoData field of first Memo in the
     * transaction, empty if no Memo is present.
     * @param status Success status: 0 - success, 1 - failed by sender's fault,
     * 2 - failed by receiver's fault.
     */
    struct ResponseBody {
        uint64 blockNumber;
        uint64 blockTimestamp;
        string sourceAddress;
        bytes32 sourceAddressHash;
        bytes32 receivingAddressHash;
        bytes32 intendedReceivingAddressHash;
        int256 spentAmount;
        int256 intendedSpentAmount;
        int256 receivedAmount;
        int256 intendedReceivedAmount;
        bool hasMemoData;
        bytes firstMemoData;
        bool hasDestinationTag;
        uint256 destinationTag;
        uint8 status;
    }
}
