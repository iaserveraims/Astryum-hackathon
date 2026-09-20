// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {AstryumCageParams, AstryumStackFactory, AstryumVaultDeployer} from "../src/AstryumStackFactory.sol";
import {AstryumVault} from "../src/AstryumVault.sol";
import {XrplCouncilBridge} from "../src/XrplCouncilBridge.sol";
import {MockFXRP, Mock4626Venue, MockQueuedVenue} from "./mocks/Mocks.sol";

/**
 * The institutional factory's one job, inherited from the Legacy one: a pote
 * belongs to ONE XRPL council, and only that council can bring it into the
 * world — rule 7.4 (the OPERATOR deploys, no Astryum key anywhere) plus Z8
 * (one council, one pote; an operator with two policies runs two councils).
 */
contract AstryumStackFactoryTest is Test {
    string constant COUNCIL_A = "rsmvJMhhjn6L3oCf29UZE2mtw9kcsKDmrf"; // pote A (Conservador)
    string constant COUNCIL_B = "rPT1Sjq2YGrBMTttX4GZHjKu9dyfzbpAYe"; // pote B (Rendimiento)
    bytes32 constant SOURCE = bytes32("testXRP");

    address constant REGISTRY = 0xaD67FE66660Fb8dFE9d6b1b4240d8650e30F6019;

    AstryumStackFactory factory;
    MockFXRP fxrp;
    Mock4626Venue syncVenue;
    MockQueuedVenue queuedVenue;

    address mac = makeAddr("masterAccountController");
    address macFallback = makeAddr("macFallback");
    address paA = makeAddr("personalAccountOfCouncilA");
    address paB = makeAddr("personalAccountOfCouncilB");
    address stranger = makeAddr("stranger");

    bytes32 constant REF = keccak256("politica-conservadora-v1");

    function setUp() public {
        vm.etch(REGISTRY, hex"00");
        vm.mockCall(
            REGISTRY,
            abi.encodeWithSignature("getContractAddressByName(string)", "MasterAccountController"),
            abi.encode(mac)
        );
        _setPersonalAccount(COUNCIL_A, paA);
        _setPersonalAccount(COUNCIL_B, paB);

        factory = new AstryumStackFactory(SOURCE, macFallback);
        fxrp = new MockFXRP();
        syncVenue = new Mock4626Venue(fxrp);
        queuedVenue = new MockQueuedVenue(fxrp);
    }

    // ── helpers ──────────────────────────────────────────────────────────────

    function _setPersonalAccount(string memory councilR, address pa) internal {
        vm.mockCall(mac, abi.encodeWithSignature("getPersonalAccount(string)", councilR), abi.encode(pa));
    }

    /// Pote A shape: synchronous, one sync venue.
    function _paramsA() internal view returns (AstryumCageParams memory p) {
        AstryumVault.InitialVenue[] memory init = new AstryumVault.InitialVenue[](1);
        init[0] = AstryumVault.InitialVenue(address(syncVenue), AstryumVault.VenueKind.ERC4626);
        p = AstryumCageParams({
            asset: fxrp,
            name: "Astryum Pote A",
            symbol: "apA-FXRP",
            constitutionRef: REF,
            cooldown: 0,
            bufferFloorBps: 1000,
            initialVenues: init
        });
    }

    /// Pote B shape: 72h cooldown (firelight.runtime.json), queued venue.
    function _paramsB() internal view returns (AstryumCageParams memory p) {
        AstryumVault.InitialVenue[] memory init = new AstryumVault.InitialVenue[](1);
        init[0] = AstryumVault.InitialVenue(address(queuedVenue), AstryumVault.VenueKind.ERC4626Queued);
        p = AstryumCageParams({
            asset: fxrp,
            name: "Astryum Pote B",
            symbol: "apB-FXRP",
            constitutionRef: REF,
            cooldown: 72 hours,
            bufferFloorBps: 1000,
            initialVenues: init
        });
    }

    // ── birth ────────────────────────────────────────────────────────────────

    function test_councilsOwnAccountCreatesItsPote() public {
        vm.prank(paA);
        (address bridge, address vault) = factory.create(COUNCIL_A, _paramsA());

        AstryumVault pote = AstryumVault(vault);
        assertEq(pote.council(), bridge, "the pote must obey its bridge");
        assertEq(XrplCouncilBridge(bridge).vault(), vault, "the bridge must be bound to its pote");
        assertEq(XrplCouncilBridge(bridge).COUNCIL_ADDRESS_HASH(), keccak256(bytes(COUNCIL_A)));
        assertEq(XrplCouncilBridge(bridge).SOURCE_ID(), SOURCE, "source id comes from the factory, not the caller");
        assertEq(pote.asset(), address(fxrp));
        assertEq(pote.constitutionRef(), REF);
        assertEq(pote.COOLDOWN(), 0);
        assertEq(pote.BUFFER_FLOOR_BPS(), 1000);
        assertEq(pote.name(), "Astryum Pote A");
        assertEq(pote.symbol(), "apA-FXRP");
    }

    /// Z8 in factory form: the SAME operator's two policies are two councils,
    /// two potes, two exit speeds — nothing shared, nothing crossed (§7.3).
    function test_onePolicyOnePote_TwoCouncilsTwoShapes() public {
        vm.prank(paA);
        (, address vaultA) = factory.create(COUNCIL_A, _paramsA());
        vm.prank(paB);
        (address bridgeB, address vaultB) = factory.create(COUNCIL_B, _paramsB());

        assertTrue(vaultA != vaultB);
        assertEq(AstryumVault(vaultA).COOLDOWN(), 0);
        assertEq(AstryumVault(vaultB).COOLDOWN(), 72 hours);
        assertEq(AstryumVault(vaultB).council(), bridgeB);
        assertEq(factory.vaultCount(), 2);
    }

    /// I4 travels through the factory too: a queued venue in a synchronous
    /// pote is refused at BIRTH, not discovered in production.
    function test_queuedVenueInASyncPoteIsRefusedAtBirth() public {
        AstryumCageParams memory bad = _paramsA(); // cooldown 0...
        bad.initialVenues[0] = AstryumVault.InitialVenue(address(queuedVenue), AstryumVault.VenueKind.ERC4626Queued);
        vm.prank(paA);
        vm.expectRevert(AstryumVault.QueuedVenueNeedsCooldown.selector);
        factory.create(COUNCIL_A, bad);
    }

    // ── authority ────────────────────────────────────────────────────────────

    function test_strangerCannotCreateAPoteForACouncil() public {
        vm.prank(stranger);
        vm.expectRevert(
            abi.encodeWithSelector(AstryumStackFactory.NotThisCouncilsAccount.selector, paA, stranger)
        );
        factory.create(COUNCIL_A, _paramsA());
    }

    function test_oneCouncilsAccountCannotCreateAnothersPote() public {
        vm.prank(paB);
        vm.expectRevert(abi.encodeWithSelector(AstryumStackFactory.NotThisCouncilsAccount.selector, paA, paB));
        factory.create(COUNCIL_A, _paramsA());
    }

    function test_fallsBackToTheDeployTimeMacWhenTheRegistryDoesNotListIt() public {
        vm.mockCall(
            REGISTRY,
            abi.encodeWithSignature("getContractAddressByName(string)", "MasterAccountController"),
            abi.encode(address(0))
        );
        vm.mockCall(macFallback, abi.encodeWithSignature("getPersonalAccount(string)", COUNCIL_A), abi.encode(paA));
        assertEq(factory.masterAccountController(), macFallback);
        vm.prank(paA);
        (, address vault) = factory.create(COUNCIL_A, _paramsA());
        assertEq(factory.vaultOfAddress(COUNCIL_A), vault);
    }

    function test_refusesWhenTheCouncilHasNoPersonalAccount() public {
        _setPersonalAccount(COUNCIL_A, address(0));
        vm.prank(paA);
        vm.expectRevert(abi.encodeWithSelector(AstryumStackFactory.NoPersonalAccount.selector, COUNCIL_A));
        factory.create(COUNCIL_A, _paramsA());
    }

    function test_aCouncilGetsOnePoteAndOnlyOne() public {
        vm.prank(paA);
        (, address vaultA) = factory.create(COUNCIL_A, _paramsA());
        vm.prank(paA);
        vm.expectRevert(abi.encodeWithSelector(AstryumStackFactory.CageAlreadyExists.selector, vaultA));
        factory.create(COUNCIL_A, _paramsB());
    }

    function test_onlyTheFactoryMayAskTheDeployerForAPote() public {
        AstryumVaultDeployer deployer = factory.DEPLOYER();
        assertEq(deployer.FACTORY(), address(factory));
        vm.prank(stranger);
        vm.expectRevert(AstryumVaultDeployer.NotFactory.selector);
        deployer.deploy(keccak256(bytes(COUNCIL_A)), address(0xdead), _paramsA());
    }

    function test_theFactoryKeepsNoPowerOverWhatItBore() public {
        vm.prank(paA);
        (address bridge,) = factory.create(COUNCIL_A, _paramsA());
        vm.prank(address(factory));
        vm.expectRevert(XrplCouncilBridge.AlreadyBound.selector);
        XrplCouncilBridge(bridge).bind(address(0xdead));
    }

    // ── prediction (one signature creates AND makes the genesis deposit) ─────

    function test_predictedAddressesMatchWhatIsDeployed() public {
        (address predictedBridge, address predictedVault) = factory.predictAddresses(COUNCIL_A, _paramsA());
        vm.prank(paA);
        (address bridge, address vault) = factory.create(COUNCIL_A, _paramsA());
        assertEq(bridge, predictedBridge);
        assertEq(vault, predictedVault);
    }

    function test_differentEternalParamsPredictADifferentPote() public view {
        (, address v1) = factory.predictAddresses(COUNCIL_A, _paramsA());
        AstryumCageParams memory other = _paramsA();
        other.cooldown = 24 hours; // an eternal param, changed
        (, address v2) = factory.predictAddresses(COUNCIL_A, other);
        assertTrue(v1 != v2, "the prediction must depend on the eternal params");
    }

    /// The born pote works end to end: the genesis deposit (Z10) mints shares
    /// and the 4626 books open correctly.
    function test_theBornPoteAcceptsTheGenesisDeposit() public {
        vm.prank(paA);
        (, address vault) = factory.create(COUNCIL_A, _paramsA());

        fxrp.mint(address(this), 1_000e6);
        fxrp.approve(vault, type(uint256).max);
        uint256 shares = AstryumVault(vault).deposit(1_000e6, address(this));

        assertGt(shares, 0);
        assertEq(AstryumVault(vault).totalAssets(), 1_000e6);
    }
}
