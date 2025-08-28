const fs = require('fs');
const path = require('path');
const ts = require('typescript');
const { Keypair } = require('@solana/web3.js');

function loadRelayerService() {
  const Module = require('module');
  const baseDir = path.resolve(__dirname, '..');

  // Compile relayerService.ts and stub config dependency
  const serviceTsPath = path.join(baseDir, 'relayerService.ts');
  const serviceSource = fs.readFileSync(serviceTsPath, 'utf8');
  let { outputText } = ts.transpileModule(serviceSource, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019 },
  });
  outputText = outputText.replace(
    'require("./config")',
    '{ config: { supportedPools: [], priorityFeeLevel: "none" } }'
  );
  const serviceJsPath = path.join(baseDir, 'relayerService.js');
  const serviceModule = new Module(serviceJsPath, module);
  serviceModule.paths = Module._nodeModulePaths(baseDir);
  serviceModule._compile(outputText, serviceJsPath);
  return serviceModule.exports.RelayerService;
}

const RelayerService = loadRelayerService();

describe('RelayerService requeue behaviour', () => {
  const dummyConnection = {};
  const relayerWallet = Keypair.generate();
  const programId = Keypair.generate().publicKey;
  const cpSwapProgramId = Keypair.generate().publicKey;
  const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };

  test('requeuePendingOrders is called and queue restored', async () => {
    const service = new RelayerService(
      dummyConnection,
      relayerWallet,
      programId,
      cpSwapProgramId,
      logger
    );

    const poolId = Keypair.generate().publicKey;
    const user = Keypair.generate().publicKey;

    const order1 = await service.submitOrder({
      poolId,
      amountIn: '100',
      minAmountOut: '90',
      isBaseInput: true,
      userPublicKey: user,
    });
    const order2 = await service.submitOrder({
      poolId,
      amountIn: '100',
      minAmountOut: '90',
      isBaseInput: true,
      userPublicKey: user,
    });

    const spy = jest.spyOn(service, 'requeuePendingOrders');

    await service.executeOrder(order1.orderId);

    expect(spy).toHaveBeenCalledWith(order1.orderId);
    expect(service.executionQueue).toEqual([order1.orderId, order2.orderId]);
  });

  test('later orders are retried after failure', async () => {
    const service = new RelayerService(
      dummyConnection,
      relayerWallet,
      programId,
      cpSwapProgramId,
      logger
    );

    const poolId = Keypair.generate().publicKey;
    const user = Keypair.generate().publicKey;

    const order1 = await service.submitOrder({
      poolId,
      amountIn: '100',
      minAmountOut: '90',
      isBaseInput: true,
      userPublicKey: user,
    });
    const order2 = await service.submitOrder({
      poolId,
      amountIn: '100',
      minAmountOut: '90',
      isBaseInput: true,
      userPublicKey: user,
    });

    await service.executeOrder(order1.orderId);

    let next = service.executionQueue.shift();
    await service.executeOrder(next);

    next = service.executionQueue.shift();
    expect(next).toBe(order2.orderId);
    expect(service.orders.get(order2.orderId).status).toBe('pending');

    await service.executeOrder(next);
    expect(service.orders.get(order2.orderId).status).toBe('failed');
  });
});
