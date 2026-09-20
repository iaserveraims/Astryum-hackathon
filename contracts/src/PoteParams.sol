// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {AstryumVault} from "./AstryumVault.sol";

/**
 * @notice La ficha de nacimiento de un pote de la generación V2, en un solo
 * valor. La comparten la jaula (`createPote`), el deployer (`PoteDeployer`) y
 * el propio pote (su constructor), así que los tres hablan de exactamente lo
 * mismo y el ABI codifica un struct en vez de doce argumentos sueltos (que es,
 * además, lo que la pila del EVM aguanta).
 *
 * Es lo que el depositante lee: nada de esto cambia de FORMA después. Lo que
 * cambia de VALOR (tope por cuenta, puerta) lo hace por orden del consejo.
 */
struct PoteParams {
    string name;
    string symbol;
    uint48 cooldown;
    uint16 bufferFloorBps;
    /// Tope de `setPayees` de por vida. > 2000 ⇒ pote privado (exige puerta eterna).
    uint16 maxPayeeBps;
    /// Tope de posición por cuenta receptora, en unidades del activo. 0 = sin tope.
    uint256 maxDepositPerUser;
    /// Puerta de entrada (`IUserGate`) o 0 = abierto.
    address initialGate;
    AstryumVault.InitialVenue[] initialVenues;
}
