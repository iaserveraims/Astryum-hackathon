// SPDX-License-Identifier: MIT
pragma solidity >=0.7.6 <0.9;

import {IXRPPayment} from "./IXRPPayment.sol";

// VENDORED verbatim from the flare-periphery-contracts npm package (scope
// "flarenetwork"); coston2/ and flare/ copies are byte-identical (2026-07-16).
interface IXRPPaymentVerification {
    function verifyXRPPayment(IXRPPayment.Proof calldata _proof) external view returns (bool _proved);
}
