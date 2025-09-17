# Continuum CP-Swap SDK

A TypeScript SDK for interacting with the Continuum CP-Swap MEV protection system on Solana. This SDK provides easy-to-use interfaces for submitting orders, monitoring execution, and integrating with wallets and frontends.

## Table of Contents

- [Overview](#overview)
- [Installation](#installation)
- [Quick Start](#quick-start)
- [Core Concepts](#core-concepts)
- [Wallet Integration](#wallet-integration)
- [Frontend Integration](#frontend-integration)
- [Price Queries](#price-queries)
- [Order Submission](#order-submission)
- [Relayer Integration](#relayer-integration)
- [API Reference](#api-reference)
- [Examples](#examples)

## Overview

Continuum CP-Swap provides MEV (Maximum Extractable Value) protection for Raydium CP-Swap pools through:

- **FIFO Ordering**: All swaps execute in the order they were submitted
- **Custom Authority**: Pools controlled by Continuum program, preventing direct access
- **Relayer Network**: Decentralized relayers execute orders in sequence
- **Fair Pricing**: No front-running or sandwich attacks possible

## Pool Initialization with CTM Authority

### Creating a New Protected Pool

To create a CP-Swap pool with CTM Wrapper authority for MEV protection:

```typescript
import {
  createInitializeCpSwapPoolDirectInstruction,
  getCpSwapPDAs
} from '@continuum/cp-swap-sdk';
import { createAssociatedTokenAccountInstruction } from '@solana/spl-token';
import BN from 'bn.js';

async function initializeProtectedPool() {
  // 1. Define pool parameters
  const ammConfigIndex = 0;
  const indexBuffer = Buffer.allocUnsafe(2);
  indexBuffer.writeUInt16BE(ammConfigIndex);

  const [ammConfig] = PublicKey.findProgramAddressSync(
    [Buffer.from('amm_config'), indexBuffer],
    CP_SWAP_PROGRAM_ID
  );

  // 2. Get CP-Swap PDAs
  const cpSwapPDAs = getCpSwapPDAs(tokenAMint, tokenBMint, ammConfig);

  // 3. Create fee account (required by CP-Swap)
  const feeOwner = new PublicKey('GsV1jugD8ftfWBYNykA9SLK2V4mQqUW2sLop8MAfjVRq');
  const feeAccount = getAssociatedTokenAddressSync(cpSwapPDAs.sortedToken0, feeOwner);

  // Ensure fee account exists
  const feeAccountInfo = await connection.getAccountInfo(feeAccount);
  if (!feeAccountInfo) {
    const createFeeAccountTx = new Transaction().add(
      createAssociatedTokenAccountInstruction(
        wallet.publicKey,
        feeAccount,
        feeOwner,
        cpSwapPDAs.sortedToken0
      )
    );
    await sendAndConfirmTransaction(connection, createFeeAccountTx, [wallet]);
  }

  // 4. Initialize pool with CTM authority
  const initPoolIx = createInitializeCpSwapPoolDirectInstruction({
    creator: wallet.publicKey,
    ammConfig,
    token0Mint: tokenAMint,
    token1Mint: tokenBMint,
    initAmount0: new BN(100 * 10 ** 9), // 100 tokens with 9 decimals
    initAmount1: new BN(100 * 10 ** 6), // 100 tokens with 6 decimals
    openTime: new BN(0), // Pool opens immediately
    feeOwner
  });

  const tx = new Transaction().add(initPoolIx);
  const signature = await sendAndConfirmTransaction(connection, tx, [wallet]);

  console.log('✅ Pool initialized with CTM Wrapper authority!');
  console.log('Pool ID:', cpSwapPDAs.poolState.toBase58());
  console.log('Transaction:', signature);

  return cpSwapPDAs;
}
```

### Important Notes for Pool Initialization

- **Authority Type**: Set to `1` for custom authority
- **Custom Authority**: Automatically set to CTM Wrapper's pool authority PDA
- **Fee Account**: Must be initialized before pool creation
- **Token Sorting**: Tokens are automatically sorted by their public key bytes
- **AMM Config**: Must exist on-chain (index 0 is commonly used on devnet)

## Installation

```bash
npm install @continuum/cp-swap-sdk
# or
yarn add @continuum/cp-swap-sdk
```

## Quick Start

```typescript
import { Connection, PublicKey } from '@solana/web3.js';
import { ContinuumClient } from '@continuum/cp-swap-sdk';

// Initialize client
const connection = new Connection('https://api.mainnet-beta.solana.com');
const client = new ContinuumClient(connection);

// Get pool info
const poolId = new PublicKey('...');
const poolInfo = await client.getPoolInfo(poolId);

// Submit swap order
const result = await client.submitOrder({
  poolId,
  amountIn: 1000000000, // 1 token (9 decimals)
  minAmountOut: 950000000, // 0.95 tokens (5% slippage)
  isBaseInput: true,
  wallet: userWallet,
});
```

## Core Concepts

### FIFO State

The global FIFO state tracks the current sequence number for order execution:

```typescript
interface FifoState {
  currentSequence: BN;
  admin: PublicKey;
  emergencyPause: boolean;
}
```

### Orders

Orders are submitted with swap parameters and assigned a sequence number:

```typescript
interface Order {
  user: PublicKey;
  poolId: PublicKey;
  sequence: BN;
  amountIn: BN;
  minAmountOut: BN;
  isBaseInput: boolean;
  timestamp: BN;
  status: OrderStatus;
}

enum OrderStatus {
  Pending = 'pending',
  Executed = 'executed',
  Cancelled = 'cancelled',
  Failed = 'failed'
}
```

### Pool Registry

Protected pools are registered with Continuum authority:

```typescript
interface PoolRegistry {
  poolId: PublicKey;
  continuumAuthority: PublicKey;
  isActive: boolean;
  createdAt: BN;
}
```

## Wallet Integration

### 1. Basic Wallet Connection

```typescript
import { useWallet } from '@solana/wallet-adapter-react';
import { ContinuumClient } from '@continuum/cp-swap-sdk';

function SwapComponent() {
  const wallet = useWallet();
  const client = useMemo(
    () => new ContinuumClient(connection),
    [connection]
  );

  const handleSwap = async () => {
    if (!wallet.connected) {
      await wallet.connect();
    }

    const result = await client.submitOrder({
      poolId,
      amountIn,
      minAmountOut,
      isBaseInput: true,
      wallet: wallet.adapter,
    });
  };
}
```

### 2. Transaction Building for Wallets

For wallets that need to build transactions manually:

```typescript
// Build order submission transaction
const tx = await client.buildSubmitOrderTransaction({
  poolId,
  amountIn,
  minAmountOut,
  isBaseInput: true,
  userPublicKey: wallet.publicKey,
});

// Wallet signs and sends
const signature = await wallet.sendTransaction(tx, connection);
```

### 3. Versioned Transaction Support

For wallets supporting versioned transactions:

```typescript
const versionedTx = await client.buildVersionedTransaction({
  poolId,
  amountIn,
  minAmountOut,
  isBaseInput: true,
  userPublicKey: wallet.publicKey,
  lookupTables: [/* address lookup tables */],
});

const signature = await wallet.sendTransaction(versionedTx);
```

## Frontend Integration

### 1. React Hook Example

```typescript
import { useEffect, useState } from 'react';
import { ContinuumClient, PoolInfo } from '@continuum/cp-swap-sdk';

export function useContinuumPool(poolId: string) {
  const [poolInfo, setPoolInfo] = useState<PoolInfo | null>(null);
  const [price, setPrice] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const client = new ContinuumClient(connection);
    
    // Fetch initial data
    const fetchData = async () => {
      try {
        const info = await client.getPoolInfo(new PublicKey(poolId));
        setPoolInfo(info);
        
        const currentPrice = await client.getPoolPrice(new PublicKey(poolId));
        setPrice(currentPrice);
      } catch (error) {
        console.error('Error fetching pool data:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchData();

    // Set up price updates
    const interval = setInterval(async () => {
      try {
        const currentPrice = await client.getPoolPrice(new PublicKey(poolId));
        setPrice(currentPrice);
      } catch (error) {
        console.error('Error updating price:', error);
      }
    }, 5000); // Update every 5 seconds

    return () => clearInterval(interval);
  }, [poolId]);

  return { poolInfo, price, loading };
}
```

### 2. Swap Interface Component

```typescript
function SwapInterface({ poolId }: { poolId: string }) {
  const { poolInfo, price } = useContinuumPool(poolId);
  const [amountIn, setAmountIn] = useState('');
  const [slippage, setSlippage] = useState(0.5); // 0.5%
  
  const estimatedOutput = useMemo(() => {
    if (!price || !amountIn) return '0';
    
    const input = parseFloat(amountIn);
    const output = input * price;
    const minOutput = output * (1 - slippage / 100);
    
    return {
      expected: output.toFixed(6),
      minimum: minOutput.toFixed(6),
    };
  }, [price, amountIn, slippage]);

  const handleSwap = async () => {
    const client = new ContinuumClient(connection);
    
    try {
      const result = await client.submitOrder({
        poolId: new PublicKey(poolId),
        amountIn: parseFloat(amountIn) * 10 ** poolInfo.token0.decimals,
        minAmountOut: parseFloat(estimatedOutput.minimum) * 10 ** poolInfo.token1.decimals,
        isBaseInput: true,
        wallet,
      });
      
      // Show success message
      toast.success(`Order submitted! Sequence: ${result.sequence}`);
      
      // Monitor order status
      client.monitorOrder(result.orderPda, (status) => {
        if (status === 'executed') {
          toast.success('Swap executed successfully!');
        } else if (status === 'failed') {
          toast.error('Swap failed');
        }
      });
    } catch (error) {
      toast.error(`Error: ${error.message}`);
    }
  };

  return (
    <div className="swap-interface">
      <input
        type="number"
        value={amountIn}
        onChange={(e) => setAmountIn(e.target.value)}
        placeholder="Amount to swap"
      />
      
      <div className="output-estimate">
        <p>Expected: {estimatedOutput.expected}</p>
        <p>Minimum: {estimatedOutput.minimum}</p>
      </div>
      
      <button onClick={handleSwap}>Swap</button>
    </div>
  );
}
```

## Price Queries

### 1. Get Current Pool Price

```typescript
// Get spot price (token1 per token0)
const spotPrice = await client.getPoolPrice(poolId);

// Get price with impact for specific amount
const priceImpact = await client.getPriceImpact(poolId, amountIn, isBaseInput);
console.log(`Price impact: ${priceImpact.percentage}%`);
```

### 2. Get Pool Reserves

```typescript
const reserves = await client.getPoolReserves(poolId);
console.log(`Token0: ${reserves.token0.amount}`);
console.log(`Token1: ${reserves.token1.amount}`);
```

### 3. Calculate Output Amount

```typescript
// Calculate expected output for a swap
const output = await client.calculateSwapOutput({
  poolId,
  amountIn,
  isBaseInput: true,
});

console.log(`Input: ${output.amountIn}`);
console.log(`Output: ${output.amountOut}`);
console.log(`Fee: ${output.fee}`);
console.log(`Price Impact: ${output.priceImpact}%`);
```

## Order Submission

### 1. Direct Order Submission

```typescript
// Submit order with connected wallet
const result = await client.submitOrder({
  poolId,
  amountIn: new BN(1000000000),
  minAmountOut: new BN(950000000),
  isBaseInput: true,
  wallet: userWallet,
});

console.log(`Order submitted with sequence: ${result.sequence}`);
console.log(`Order PDA: ${result.orderPda}`);
console.log(`Transaction: ${result.signature}`);
```

### 2. Partial Signed Transaction

For integration with relayers, create a partially signed transaction:

```typescript
// Create partial signed transaction
const partialTx = await client.createPartialSignedOrder({
  poolId,
  amountIn,
  minAmountOut,
  isBaseInput: true,
  userPublicKey: wallet.publicKey,
});

// User signs the transaction
const signedTx = await wallet.signTransaction(partialTx.transaction);

// Send to relayer
const relayerUrl = 'https://relayer.continuum.fi';
const response = await fetch(`${relayerUrl}/submit`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    transaction: signedTx.serialize().toString('base64'),
    orderData: partialTx.orderData,
  }),
});

const { orderId, estimatedExecution } = await response.json();
```

### 3. Order Cancellation

```typescript
// Cancel pending order
const cancelResult = await client.cancelOrder({
  orderPda: orderPublicKey,
  wallet: userWallet,
});

console.log(`Order cancelled: ${cancelResult.signature}`);
```

## Relayer Integration

### 1. Sending Orders to Relayers

```typescript
class RelayerClient {
  constructor(private relayerUrl: string) {}

  async submitOrder(params: {
    poolId: PublicKey;
    amountIn: BN;
    minAmountOut: BN;
    isBaseInput: boolean;
    userWallet: Wallet;
  }) {
    // Build partial transaction
    const client = new ContinuumClient(connection);
    const partialTx = await client.createPartialSignedOrder({
      poolId: params.poolId,
      amountIn: params.amountIn,
      minAmountOut: params.minAmountOut,
      isBaseInput: params.isBaseInput,
      userPublicKey: params.userWallet.publicKey,
    });

    // User signs
    const signedTx = await params.userWallet.signTransaction(
      partialTx.transaction
    );

    // Submit to relayer
    const response = await fetch(`${this.relayerUrl}/api/v1/orders`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': process.env.RELAYER_API_KEY,
      },
      body: JSON.stringify({
        transaction: signedTx.serialize().toString('base64'),
        poolId: params.poolId.toBase58(),
        amountIn: params.amountIn.toString(),
        minAmountOut: params.minAmountOut.toString(),
        isBaseInput: params.isBaseInput,
        userPublicKey: params.userWallet.publicKey.toBase58(),
      }),
    });

    if (!response.ok) {
      throw new Error(`Relayer error: ${response.statusText}`);
    }

    return response.json();
  }

  async getOrderStatus(orderId: string) {
    const response = await fetch(
      `${this.relayerUrl}/api/v1/orders/${orderId}`
    );
    return response.json();
  }

  async subscribeToOrder(orderId: string) {
    const ws = new WebSocket(
      `${this.relayerUrl.replace('http', 'ws')}/ws/orders/${orderId}`
    );

    return new Promise((resolve, reject) => {
      ws.on('message', (data) => {
        const update = JSON.parse(data.toString());
        if (update.status === 'executed') {
          resolve(update);
          ws.close();
        } else if (update.status === 'failed') {
          reject(new Error(update.error));
          ws.close();
        }
      });

      ws.on('error', reject);
    });
  }
}
```

### 2. Relayer Selection

```typescript
// Get list of active relayers
async function getActiveRelayers(): Promise<RelayerInfo[]> {
  const response = await fetch('https://api.continuum.fi/relayers');
  const relayers = await response.json();
  
  // Sort by performance metrics
  return relayers.sort((a, b) => {
    // Consider success rate, latency, and fee
    const scoreA = a.successRate * 100 - a.avgLatency - a.feePercentage;
    const scoreB = b.successRate * 100 - b.avgLatency - b.feePercentage;
    return scoreB - scoreA;
  });
}

// Select best relayer for order
async function selectRelayer(orderSize: BN): Promise<RelayerInfo> {
  const relayers = await getActiveRelayers();
  
  // Filter by minimum stake and capacity
  const eligible = relayers.filter(r => 
    r.stake.gte(MIN_RELAYER_STAKE) &&
    r.availableCapacity.gte(orderSize)
  );
  
  if (eligible.length === 0) {
    throw new Error('No eligible relayers available');
  }
  
  return eligible[0];
}
```

### 3. Monitoring Order Execution

```typescript
class OrderMonitor {
  private subscribers = new Map<string, Set<(update: OrderUpdate) => void>>();

  async monitorOrder(
    orderPda: PublicKey,
    callback: (update: OrderUpdate) => void
  ) {
    const orderId = orderPda.toBase58();
    
    // Add subscriber
    if (!this.subscribers.has(orderId)) {
      this.subscribers.set(orderId, new Set());
      this.startMonitoring(orderPda);
    }
    this.subscribers.get(orderId)!.add(callback);
    
    // Return unsubscribe function
    return () => {
      const subs = this.subscribers.get(orderId);
      if (subs) {
        subs.delete(callback);
        if (subs.size === 0) {
          this.subscribers.delete(orderId);
        }
      }
    };
  }

  private async startMonitoring(orderPda: PublicKey) {
    const client = new ContinuumClient(connection);
    
    // Poll for updates
    const interval = setInterval(async () => {
      try {
        const order = await client.getOrder(orderPda);
        const update: OrderUpdate = {
          orderId: orderPda.toBase58(),
          status: order.status,
          sequence: order.sequence,
          timestamp: new Date(),
        };
        
        // Notify subscribers
        const subs = this.subscribers.get(orderPda.toBase58());
        if (subs) {
          subs.forEach(callback => callback(update));
        }
        
        // Stop monitoring if order is final
        if (order.status === 'executed' || order.status === 'cancelled') {
          clearInterval(interval);
          this.subscribers.delete(orderPda.toBase58());
        }
      } catch (error) {
        console.error('Error monitoring order:', error);
      }
    }, 2000); // Check every 2 seconds
  }
}
```

## API Reference

### ContinuumClient

Main client for interacting with Continuum CP-Swap.

```typescript
class ContinuumClient {
  constructor(
    connection: Connection,
    programId?: PublicKey,
    cpSwapProgramId?: PublicKey
  );

  // Pool queries
  async getPoolInfo(poolId: PublicKey): Promise<PoolInfo>;
  async getPoolPrice(poolId: PublicKey): Promise<number>;
  async getPoolReserves(poolId: PublicKey): Promise<PoolReserves>;
  async getPriceImpact(
    poolId: PublicKey,
    amountIn: BN,
    isBaseInput: boolean
  ): Promise<PriceImpact>;

  // Order management
  async submitOrder(params: SubmitOrderParams): Promise<SubmitOrderResult>;
  async cancelOrder(params: CancelOrderParams): Promise<CancelOrderResult>;
  async getOrder(orderPda: PublicKey): Promise<Order>;
  async getUserOrders(user: PublicKey): Promise<Order[]>;

  // Transaction building
  async buildSubmitOrderTransaction(
    params: BuildOrderParams
  ): Promise<Transaction>;
  async createPartialSignedOrder(
    params: BuildOrderParams
  ): Promise<PartialSignedOrder>;

  // Monitoring
  monitorOrder(
    orderPda: PublicKey,
    callback: (status: OrderStatus) => void
  ): () => void;
}
```

### Types

```typescript
interface SubmitOrderParams {
  poolId: PublicKey;
  amountIn: BN;
  minAmountOut: BN;
  isBaseInput: boolean;
  wallet: Wallet | WalletAdapter;
}

interface PoolInfo {
  poolId: PublicKey;
  token0: TokenInfo;
  token1: TokenInfo;
  fee: number;
  liquidity: BN;
  sqrtPriceX64: BN;
  tick: number;
  observationIndex: number;
  protocolFeesToken0: BN;
  protocolFeesToken1: BN;
  isProtected: boolean;
  continuumAuthority?: PublicKey;
}

interface PriceImpact {
  percentage: number;
  priceAfter: number;
  amountOut: BN;
}

interface OrderUpdate {
  orderId: string;
  status: OrderStatus;
  sequence: BN;
  timestamp: Date;
  executionPrice?: number;
  actualAmountOut?: BN;
}
```

## Examples

### 1. Complete Swap Flow

```typescript
async function performSwap() {
  const client = new ContinuumClient(connection);
  
  // 1. Get pool info and check if protected
  const poolInfo = await client.getPoolInfo(poolId);
  if (!poolInfo.isProtected) {
    console.warn('Pool is not protected by Continuum');
  }
  
  // 2. Calculate swap amounts
  const amountIn = new BN(1_000_000_000); // 1 token
  const output = await client.calculateSwapOutput({
    poolId,
    amountIn,
    isBaseInput: true,
  });
  
  // 3. Apply slippage tolerance
  const slippageBps = 50; // 0.5%
  const minAmountOut = output.amountOut
    .muln(10000 - slippageBps)
    .divn(10000);
  
  // 4. Submit order
  const result = await client.submitOrder({
    poolId,
    amountIn,
    minAmountOut,
    isBaseInput: true,
    wallet,
  });
  
  console.log(`Order submitted: ${result.orderPda}`);
  
  // 5. Monitor execution
  const unsubscribe = client.monitorOrder(
    result.orderPda,
    (status) => {
      console.log(`Order status: ${status}`);
      if (status === 'executed') {
        console.log('Swap completed!');
        unsubscribe();
      }
    }
  );
}
```

### 2. Price Feed Integration

```typescript
class PriceFeed {
  private client: ContinuumClient;
  private subscribers = new Map<string, Set<(price: number) => void>>();

  constructor(connection: Connection) {
    this.client = new ContinuumClient(connection);
    this.startPriceUpdates();
  }

  subscribe(
    poolId: string,
    callback: (price: number) => void
  ): () => void {
    if (!this.subscribers.has(poolId)) {
      this.subscribers.set(poolId, new Set());
    }
    
    this.subscribers.get(poolId)!.add(callback);
    
    return () => {
      const subs = this.subscribers.get(poolId);
      if (subs) {
        subs.delete(callback);
      }
    };
  }

  private async startPriceUpdates() {
    setInterval(async () => {
      for (const [poolId, callbacks] of this.subscribers) {
        try {
          const price = await this.client.getPoolPrice(
            new PublicKey(poolId)
          );
          callbacks.forEach(cb => cb(price));
        } catch (error) {
          console.error(`Error updating price for ${poolId}:`, error);
        }
      }
    }, 5000); // Update every 5 seconds
  }
}
```

### 3. Advanced Order Management

```typescript
class OrderManager {
  constructor(
    private client: ContinuumClient,
    private relayerClient: RelayerClient
  ) {}

  async submitWithRetry(
    params: SubmitOrderParams,
    maxRetries = 3
  ): Promise<SubmitOrderResult> {
    let lastError: Error;
    
    for (let i = 0; i < maxRetries; i++) {
      try {
        // Try direct submission first
        return await this.client.submitOrder(params);
      } catch (error) {
        lastError = error;
        
        // If direct submission fails, try relayer
        if (i < maxRetries - 1) {
          try {
            const relayerResult = await this.relayerClient.submitOrder({
              poolId: params.poolId,
              amountIn: params.amountIn,
              minAmountOut: params.minAmountOut,
              isBaseInput: params.isBaseInput,
              userWallet: params.wallet as Wallet,
            });
            
            // Wait for relayer execution
            await this.relayerClient.subscribeToOrder(
              relayerResult.orderId
            );
            
            return {
              sequence: new BN(relayerResult.sequence),
              orderPda: new PublicKey(relayerResult.orderPda),
              signature: relayerResult.signature,
            };
          } catch (relayerError) {
            console.error('Relayer submission failed:', relayerError);
          }
        }
        
        // Wait before retry
        await new Promise(resolve => setTimeout(resolve, 1000 * (i + 1)));
      }
    }
    
    throw lastError!;
  }

  async executeProgrammableSwap(params: {
    conditions: SwapCondition[];
    swapParams: SubmitOrderParams;
  }): Promise<void> {
    // Monitor conditions
    const checkConditions = async (): Promise<boolean> => {
      for (const condition of params.conditions) {
        const met = await condition.check();
        if (!met) return false;
      }
      return true;
    };
    
    // Wait for conditions
    while (!(await checkConditions())) {
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
    
    // Execute swap
    await this.submitWithRetry(params.swapParams);
  }
}

interface SwapCondition {
  check(): Promise<boolean>;
}

class PriceCondition implements SwapCondition {
  constructor(
    private client: ContinuumClient,
    private poolId: PublicKey,
    private targetPrice: number,
    private comparison: 'above' | 'below'
  ) {}

  async check(): Promise<boolean> {
    const currentPrice = await this.client.getPoolPrice(this.poolId);
    return this.comparison === 'above'
      ? currentPrice > this.targetPrice
      : currentPrice < this.targetPrice;
  }
}
```

## Security Considerations

1. **Always verify pool protection status** before submitting orders
2. **Use appropriate slippage tolerance** based on market conditions
3. **Monitor gas costs** when submitting orders
4. **Validate relayer responses** before trusting execution results
5. **Implement retry logic** for network failures
6. **Store sensitive data securely** (API keys, private keys)

## Troubleshooting

### Common Issues

1. **"Pool not registered"**: The pool hasn't been initialized with Continuum authority
2. **"Invalid sequence"**: Orders must be executed in FIFO order
3. **"Insufficient balance"**: Ensure wallet has enough tokens and SOL for fees
4. **"Slippage exceeded"**: Increase slippage tolerance or reduce order size

### Debug Mode

Enable debug logging:

```typescript
const client = new ContinuumClient(connection, {
  debug: true,
  logger: console,
});
```

## License

MIT License - see LICENSE file for details

## Support

- Documentation: https://docs.continuum.fi
- Discord: https://discord.gg/continuum
- GitHub: https://github.com/continuum-finance/cp-swap-sdk