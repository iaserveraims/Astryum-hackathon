# archive/ — código construido, superado, fuera del build

Regla del repo: lo construido no se borra, se deja inerte. Foundry compila solo
`src/` y `test/`; nada de aquí entra en el build ni en los artefactos.

- `ManagerLegacy.sol` + `ManagerLegacy.t.sol` (24-25 ago 2026): primera forma de la
  jaula de mando. Superada por `src/AstryumCage.sol` (jaula v2) tras la spec
  una nota interna de especificación (no publicada en este repo). Nunca desplegada.
