// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {CageParams, LegacyStackFactory, LegacyVaultDeployer} from "../src/LegacyStackFactory.sol";
import {LegacyVault} from "../src/LegacyVault.sol";
import {XrplCouncilBridge} from "../src/XrplCouncilBridge.sol";
import {MockFXRP, Mock4626Venue} from "./mocks/Mocks.sol";

/**
 * The factory's one job: a cage belongs to ONE council, and only that council
 * can bring it into the world.
 *
 * The bug this exists to make impossible (founder, 2026-08-05): the product
 * resolved "the" cage from configuration, so a second Legacy was shown — and
 * would have funded — the first Legacy's vault, which has no function that
 * pays principal back to any address.
 */
contract LegacyStackFactoryTest is Test {
    string constant COUNCIL_A = "rsmvJMhhjn6L3oCf29UZE2mtw9kcsKDmrf";
    string constant COUNCIL_B = "rPT1Sjq2YGrBMTttX4GZHjKu9dyfzbpAYe";
    bytes32 constant SOURCE = bytes32("testXRP");

    address constant REGISTRY = 0xaD67FE66660Fb8dFE9d6b1b4240d8650e30F6019;

    LegacyStackFactory factory;
    MockFXRP fxrp;
    Mock4626Venue venue;

    /// The MasterAccountController the registry points at, and the Personal
    /// Accounts it reports for each council.
    address mac = makeAddr("masterAccountController");
    /// A DIFFERENT controller used as the deploy-time fallback, so the tests
    /// can tell which one the factory actually consulted.
    address macFallback = makeAddr("macFallback");
    address paA = makeAddr("personalAccountOfCouncilA");
    address paB = makeAddr("personalAccountOfCouncilB");
    address stranger = makeAddr("stranger");
    address treasury = makeAddr("astryumTreasury");

    bytes32 constant REF = keccak256("constitucion-v1");

    function setUp() public {
        // Flare's registry lives at a fixed address on every network; plant code
        // there and answer the two reads the factory performs.
        vm.etch(REGISTRY, hex"00");
        vm.mockCall(
            REGISTRY,
            abi.encodeWithSignature("getContractAddressByName(string)", "MasterAccountController"),
            abi.encode(mac)
        );
        _setPersonalAccount(COUNCIL_A, paA);
        _setPersonalAccount(COUNCIL_B, paB);

        factory = new LegacyStackFactory(SOURCE, macFallback);
        fxrp = new MockFXRP();
        venue = new Mock4626Venue(fxrp);
    }

    // ── helpers ──────────────────────────────────────────────────────────────

    function _setPersonalAccount(string memory councilR, address pa) internal {
        vm.mockCall(
            mac,
            abi.encodeWithSignature("getPersonalAccount(string)", councilR),
            abi.encode(pa)
        );
    }

    function _params() internal view returns (CageParams memory p) {
        LegacyVault.InitialVenue[] memory init = new LegacyVault.InitialVenue[](1);
        init[0] = LegacyVault.InitialVenue(address(venue), LegacyVault.VenueKind.ERC4626);
        p = CageParams({
            asset: fxrp,
            constitutionRef: REF,
            protocolTreasury: treasury,
            linajeFeeBps: 3000,
            initialVenues: init
        });
    }

    // ── birth ────────────────────────────────────────────────────────────────

    function test_councilsOwnAccountCreatesItsCage() public {
        vm.prank(paA);
        (address bridge, address vault) = factory.create(COUNCIL_A, _params());

        // The stack is born in the roadmap's order and already bound: the EVM
        // mirror council never exists, not for one block.
        assertEq(LegacyVault(vault).council(), bridge, "the vault must obey its bridge");
        assertEq(XrplCouncilBridge(bridge).vault(), vault, "the bridge must be bound to its vault");
        assertEq(
            XrplCouncilBridge(bridge).COUNCIL_ADDRESS_HASH(),
            keccak256(bytes(COUNCIL_A)),
            "the bridge must obey THIS council"
        );
        assertEq(XrplCouncilBridge(bridge).SOURCE_ID(), SOURCE, "source id comes from the factory, not the caller");
        assertEq(address(LegacyVault(vault).ASSET()), address(fxrp));
        assertEq(LegacyVault(vault).constitutionRef(), REF);
    }

    function test_registryAnswersWhichCageIsWhose() public {
        vm.prank(paA);
        (address bridgeA, address vaultA) = factory.create(COUNCIL_A, _params());

        assertEq(factory.vaultOfAddress(COUNCIL_A), vaultA);
        assertEq(factory.bridgeOfAddress(COUNCIL_A), bridgeA);
        // The question the product asks about a Legacy with no cage.
        assertEq(factory.vaultOfAddress(COUNCIL_B), address(0), "a Legacy without a cage has NO cage");
        assertEq(factory.vaultCount(), 1);
    }

    /// THE bug, pinned: two Legacies, two cages, no sharing.
    function test_twoCouncilsGetTwoDifferentCages() public {
        vm.prank(paA);
        (address bridgeA, address vaultA) = factory.create(COUNCIL_A, _params());
        vm.prank(paB);
        (address bridgeB, address vaultB) = factory.create(COUNCIL_B, _params());

        assertTrue(vaultA != vaultB, "each Legacy gets its own vault");
        assertTrue(bridgeA != bridgeB, "each Legacy gets its own bridge");
        assertEq(XrplCouncilBridge(bridgeB).COUNCIL_ADDRESS_HASH(), keccak256(bytes(COUNCIL_B)));
        // And B's cage does not obey A's bridge, whatever the product believes.
        assertEq(LegacyVault(vaultB).council(), bridgeB);
        assertEq(factory.vaultCount(), 2);
    }

    // ── authority ────────────────────────────────────────────────────────────

    function test_strangerCannotCreateACageForACouncil() public {
        // Without this, anyone could squat a council's cage with parameters of
        // their choosing — an eternal linaje rate, their own treasury — and the
        // product would then show it as that Legacy's own.
        vm.prank(stranger);
        vm.expectRevert(
            abi.encodeWithSelector(LegacyStackFactory.NotThisCouncilsAccount.selector, paA, stranger)
        );
        factory.create(COUNCIL_A, _params());
    }

    function test_oneCouncilsAccountCannotCreateAnothersCage() public {
        vm.prank(paB);
        vm.expectRevert(
            abi.encodeWithSelector(LegacyStackFactory.NotThisCouncilsAccount.selector, paA, paB)
        );
        factory.create(COUNCIL_A, _params());
    }

    function test_fallsBackToTheDeployTimeMacWhenTheRegistryDoesNotListIt() public {
        // The registry may not carry "MasterAccountController" — the backend
        // has shipped this same fallback since the first 0xFE integration.
        // Without it, create() would call address(0) and revert for everyone.
        vm.mockCall(
            REGISTRY,
            abi.encodeWithSignature("getContractAddressByName(string)", "MasterAccountController"),
            abi.encode(address(0))
        );
        vm.mockCall(
            macFallback,
            abi.encodeWithSignature("getPersonalAccount(string)", COUNCIL_A),
            abi.encode(paA)
        );
        assertEq(factory.masterAccountController(), macFallback);
        vm.prank(paA);
        (, address vault) = factory.create(COUNCIL_A, _params());
        assertEq(factory.vaultOfAddress(COUNCIL_A), vault);
    }

    function test_theRegistryWinsOverTheFallbackWhenBothAnswer() public view {
        // mockCall in setUp lists the name → the registry's MAC, not the fallback.
        assertEq(factory.masterAccountController(), mac);
    }

    function test_refusesWhenTheCouncilHasNoPersonalAccount() public {
        _setPersonalAccount(COUNCIL_A, address(0));
        vm.prank(paA);
        vm.expectRevert(abi.encodeWithSelector(LegacyStackFactory.NoPersonalAccount.selector, COUNCIL_A));
        factory.create(COUNCIL_A, _params());
    }

    function test_refusesAnEmptyCouncilAddress() public {
        vm.prank(paA);
        vm.expectRevert(LegacyStackFactory.EmptyCouncilAddress.selector);
        factory.create("", _params());
    }

    function test_aCouncilGetsOneCageAndOnlyOne() public {
        vm.prank(paA);
        (, address vaultA) = factory.create(COUNCIL_A, _params());

        vm.prank(paA);
        vm.expectRevert(abi.encodeWithSelector(LegacyStackFactory.CageAlreadyExists.selector, vaultA));
        factory.create(COUNCIL_A, _params());
    }

    function test_onlyTheFactoryMayAskTheDeployerForAVault() public {
        // The address-squat: predict where a council's vault will live and get
        // there first with your own parameters. The deployer refuses everyone
        // but the factory, and the factory refuses everyone but the council.
        LegacyVaultDeployer deployer = factory.DEPLOYER();
        assertEq(deployer.FACTORY(), address(factory));

        vm.prank(stranger);
        vm.expectRevert(LegacyVaultDeployer.NotFactory.selector);
        deployer.deploy(keccak256(bytes(COUNCIL_A)), address(0xdead), _params());
    }

    function test_theFactoryKeepsNoPowerOverWhatItBore() public {
        vm.prank(paA);
        (address bridge,) = factory.create(COUNCIL_A, _params());

        // `bind` is one-shot and the factory already spent it. Nothing the
        // factory can do afterwards points that bridge anywhere else.
        vm.prank(address(factory));
        vm.expectRevert(XrplCouncilBridge.AlreadyBound.selector);
        XrplCouncilBridge(bridge).bind(address(0xdead));
    }

    // ── prediction (one signature can create AND fund) ───────────────────────

    function test_predictedAddressesMatchWhatIsDeployed() public {
        // The composer needs the vault address BEFORE the quorum signs, so a
        // single XRPL payment can create the cage and deposit into it in the
        // same batch. A mismatch here would send that deposit into nothing.
        (address predictedBridge, address predictedVault) = factory.predictAddresses(COUNCIL_A, _params());

        vm.prank(paA);
        (address bridge, address vault) = factory.create(COUNCIL_A, _params());

        assertEq(bridge, predictedBridge, "bridge address must be predictable");
        assertEq(vault, predictedVault, "vault address must be predictable");
    }

    function test_differentParamsPredictADifferentVault() public view {
        (, address v1) = factory.predictAddresses(COUNCIL_A, _params());
        CageParams memory other = _params();
        other.linajeFeeBps = 4000; // an eternal param, changed
        (, address v2) = factory.predictAddresses(COUNCIL_A, other);
        assertTrue(v1 != v2, "the prediction must depend on the eternal params");
    }

    /// The cage born here works like the hand-deployed one: capital goes in.
    function test_theBornCageAcceptsPrincipal() public {
        vm.prank(paA);
        (, address vault) = factory.create(COUNCIL_A, _params());

        fxrp.mint(address(this), 1_000e6);
        fxrp.approve(vault, type(uint256).max);
        LegacyVault(vault).deposit(100e6);

        assertEq(LegacyVault(vault).totalPrincipal(), 100e6);
        assertEq(LegacyVault(vault).idlePrincipal(), 100e6);
    }
}
