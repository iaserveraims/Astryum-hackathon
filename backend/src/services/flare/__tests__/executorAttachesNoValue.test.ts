/**
 * EL EXECUTOR NO PONE DINERO EN EL BATCH DEL USUARIO (fundador 2026-08-28,
 * al abrir el envío de FLR nativo desde la Smart Account).
 *
 * POR QUÉ ESTE TEST MIRA EL FUENTE Y NO EJECUTA. La línea que decide esto vive
 * en mitad del carril on-chain (FDC → proof → `executeDirectMintingWithData`),
 * que no se puede correr en CI: no hay proof, no hay ronda, no hay wallet. Pero
 * la regla que protege NO es una integración — es una constante. Y su fallo no
 * avisa: no revierte, no rompe ningún test, solo vacía la wallet caliente de
 * Astryum un envío cada vez. Eso es justo lo que un tripwire de fuente sí puede
 * fijar, con la misma forma que los «wiring guards» que ya existen en el repo.
 *
 * LO QUE PROTEGE. `MemoInstructions.sol` hace
 * `_personalAccount.call{value: msg.value}(userOp.callData)`: REENVÍA el
 * msg.value, no lo exige. Con 0, la Personal Account paga los `value` de sus
 * propias piernas con su propio saldo nativo (verificado contra mainnet con un
 * eth_call sobre una PA real: fondeada pasa, a cero revierte). Adjuntar
 * Σ call.value —lo que la guía de Flare dice que el executor «debe» hacer— no
 * habilita nada y convierte cada envío de FLR de un usuario en dinero de
 * Astryum, aparcado además en la cuenta del usuario.
 *
 * Mientras todos los batches tenían Σ call.value = 0 daba igual. Dejó de dar
 * igual con `pa-transfer` de FLR nativo, que es exactamente una pierna con
 * `value`.
 */
import fs from 'fs';
import path from 'path';

const SRC = fs.readFileSync(
  path.join(__dirname, '..', 'DirectMintExecutorService.ts'),
  'utf8',
);

describe('DirectMintExecutorService — el executor adjunta msg.value = 0', () => {
  it('declara la constante en cero', () => {
    expect(SRC).toMatch(/const EXECUTOR_ATTACHED_VALUE = 0n;/);
  });

  it('JAMÁS adjunta Σ call.value como valor de la transacción', () => {
    expect(SRC).not.toMatch(/value:\s*totalCallValue/);
  });

  it('las DOS llamadas a executeDirectMintingWithData (simulación y envío) adjuntan la constante', () => {
    const calls = SRC.match(/executeDirectMintingWithData[\s\S]{0,200}?\{\s*value:\s*([A-Za-z0-9_]+)\s*\}/g) ?? [];
    // staticCall + envío real. Si aparece una tercera, también tiene que pasar.
    expect(calls.length).toBeGreaterThanOrEqual(2);
    for (const c of calls) expect(c).toContain('value: EXECUTOR_ATTACHED_VALUE');
  });

  it('sigue CALCULANDO Σ call.value — para avisar, nunca para pagarlo', () => {
    // El aviso es la única razón de que el cálculo siga vivo: un batch que
    // mueve FLR nativo tiene que dejar rastro en el log del executor.
    expect(SRC).toMatch(/const totalCallValue = /);
    expect(SRC).toMatch(/if \(totalCallValue > 0n\)/);
  });
});
