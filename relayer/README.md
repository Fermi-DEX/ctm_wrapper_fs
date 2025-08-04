# Continuum Relayer Service

A high-performance relayer service for executing Continuum CP-Swap orders in FIFO sequence. This service provides HTTP and WebSocket APIs for client integrations.

## Features

- 🚀 **High Performance**: Processes orders with minimal latency
- 🔒 **Secure**: Rate limiting, input validation, and secure transaction handling
- 📡 **Real-time Updates**: WebSocket support for order status updates
- 🔄 **Auto-retry**: Configurable retry logic for failed transactions
- 📊 **Monitoring**: Built-in health checks and metrics
- 🐳 **Docker Support**: Easy deployment with Docker and Docker Compose
- 🔧 **Flexible Deployment**: Standalone, PM2, or containerized options

## Quick Start

### 1. Clone and Install

```bash
git clone https://github.com/continuum-finance/continuum-cp-swap
cd continuum-cp-swap/relayer
npm install
```

### 2. Configure

Create a `.env` file:

```env
# RPC Configuration
RPC_URL=https://api.mainnet-beta.solana.com
WS_URL=wss://api.mainnet-beta.solana.com

# Relayer Configuration
RELAYER_KEYPAIR_PATH=./relayer-keypair.json
RELAYER_FEE_BPS=10  # 0.1% fee

# Program IDs
CONTINUUM_PROGRAM_ID=A548C9LR926hnAWvYDjsXJddidhfzLf3bRb8dmYPgRKn
CP_SWAP_PROGRAM_ID=GkenxCtvEabZrwFf15D3E6LjoZTywH2afNwiqDwthyDp

# Server Configuration
PORT=8080
ALLOWED_ORIGINS=https://app.continuum.fi,http://localhost:3000

# Performance Settings
POLL_INTERVAL_MS=1000
MAX_CONCURRENT_EXECUTIONS=5
RETRY_ATTEMPTS=3
```

### 3. Running the Relayer

#### Option A: Using the Startup Script (Recommended)

```bash
# Start the relayer
./start-relayer.sh start

# Check status
./start-relayer.sh status

# View logs
./start-relayer.sh logs

# Stop the relayer
./start-relayer.sh stop

# Restart the relayer
./start-relayer.sh restart
```

#### Option B: Direct Node.js Execution

```bash
# Build the TypeScript code
npm run build

# Start in development mode (with hot reload)
npm run dev

# Start in production mode
npm start
```

#### Option C: Using PM2 (Production)

```bash
# Install PM2 globally
npm install -g pm2

# Start with PM2
RELAYER_MODE=pm2 ./start-relayer.sh start

# Or manually:
pm2 start dist/server.js --name continuum-relayer

# View logs
pm2 logs continuum-relayer

# Monitor
pm2 monit

# Stop
pm2 stop continuum-relayer
```

#### Option D: Using Docker

```bash
# Build and start with docker-compose
docker-compose up -d

# View logs
docker-compose logs -f relayer

# Stop
docker-compose down
```

### 4. Verify the Service is Running

```bash
# Check health
curl http://localhost:8080/health

# Expected response:
{
  "status": "healthy",
  "relayer": "ByDjc6nXScc8PwA8VHmeR3CjefKRs6jXyo6He3AYWCft",
  "timestamp": "2024-01-15T12:00:00.000Z",
  "version": "1.0.0"
}

# Get relayer info
curl http://localhost:8080/api/v1/info
```

### 5. Fund the Relayer

The relayer needs SOL to pay for transaction fees:

```bash
# Get the relayer address from the startup logs or info endpoint
# Example: ByDjc6nXScc8PwA8VHmeR3CjefKRs6jXyo6He3AYWCft

# Send at least 0.1 SOL to the relayer address
solana transfer ByDjc6nXScc8PwA8VHmeR3CjefKRs6jXyo6He3AYWCft 0.1
```

## API Endpoints

### HTTP API

#### Health Check
```http
GET /health
```

Response:
```json
{
  "status": "healthy",
  "relayer": "GsV1jugD8ftfWBYNykA9SLK2V4mQqUW2sLop8MAfjVRq",
  "timestamp": "2024-01-15T12:00:00.000Z",
  "version": "1.0.0"
}
```

#### Get Relayer Info
```http
GET /api/v1/info
```

Response:
```json
{
  "relayerAddress": "GsV1jugD8ftfWBYNykA9SLK2V4mQqUW2sLop8MAfjVRq",
  "continuumProgram": "A548C9LR926hnAWvYDjsXJddidhfzLf3bRb8dmYPgRKn",
  "cpSwapProgram": "GkenxCtvEabZrwFf15D3E6LjoZTywH2afNwiqDwthyDp",
  "fee": 10,
  "minOrderSize": "1000000",
  "maxOrderSize": "1000000000000",
  "supportedPools": [...],
  "performance": {
    "successRate": 0.98,
    "avgExecutionTime": 2500,
    "totalOrders": 15234
  }
}
```

#### Submit Order
```http
POST /api/v1/orders
Content-Type: application/json

{
  "transaction": "base64_encoded_partial_signed_tx",
  "poolId": "BhPUKnKuzpEYNhSSNxkze51tMVza25rgXfEv5LWgGng2",
  "amountIn": "1000000000",
  "minAmountOut": "950000000",
  "isBaseInput": true,
  "userPublicKey": "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM"
}
```

Response:
```json
{
  "success": true,
  "orderId": "ord_1234567890",
  "orderPda": "5nAnakPoRCpiMPAVm9mew5rCwz2But8DjDTwapYzCBSW",
  "sequence": "42",
  "estimatedExecutionTime": 5000,
  "fee": "100000"
}
```

#### Get Order Status
```http
GET /api/v1/orders/{orderId}
```

Response:
```json
{
  "orderId": "ord_1234567890",
  "status": "executed",
  "sequence": "42",
  "poolId": "BhPUKnKuzpEYNhSSNxkze51tMVza25rgXfEv5LWgGng2",
  "userPublicKey": "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM",
  "amountIn": "1000000000",
  "actualAmountOut": "985000000",
  "executionPrice": 0.985,
  "signature": "5eykt4UsFv8P8NJdTREpY1vzqYqyTZwkGZ7JZv7owLmnRmAMvRt2UHgGTVL3rSJE9SS",
  "executedAt": "2024-01-15T12:00:05.000Z"
}
```

#### Cancel Order
```http
DELETE /api/v1/orders/{orderId}
Authorization: Bearer {user_signature}
```

#### Get Supported Pools
```http
GET /api/v1/pools
```

#### Get Statistics
```http
GET /api/v1/stats
```

### WebSocket API

#### Subscribe to Order Updates
```javascript
const ws = new WebSocket('ws://localhost:8080/ws/orders/{orderId}');

ws.on('message', (data) => {
  const update = JSON.parse(data);
  console.log('Order update:', update);
  // {
  //   type: 'order_executed',
  //   orderId: 'ord_1234567890',
  //   status: 'executed',
  //   signature: '...',
  //   executionPrice: 0.985,
  //   actualAmountOut: '985000000'
  // }
});
```

#### Subscribe to All Events
```javascript
const ws = new WebSocket('ws://localhost:8080/ws/feed');

ws.send(JSON.stringify({
  type: 'subscribe',
  events: ['order_submitted', 'order_executed', 'order_failed']
}));
```

## How to Contact the Relayer

### Testing Connectivity

```bash
# 1. Test if the relayer is reachable
curl -I http://localhost:8080/health

# 2. Test with a simple health check
curl http://localhost:8080/health | jq

# 3. Test WebSocket connectivity
wscat -c ws://localhost:8080/ws/orders/test-order
```

### Making API Calls

#### Using cURL

```bash
# Get relayer information
curl http://localhost:8080/api/v1/info | jq

# Submit an order
curl -X POST http://localhost:8080/api/v1/orders \
  -H "Content-Type: application/json" \
  -d '{
    "transaction": "base64_encoded_transaction_here",
    "poolId": "BhPUKnKuzpEYNhSSNxkze51tMVza25rgXfEv5LWgGng2",
    "amountIn": "1000000000",
    "minAmountOut": "950000000",
    "isBaseInput": true,
    "userPublicKey": "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM"
  }' | jq

# Check order status
curl http://localhost:8080/api/v1/orders/ord_1234567890 | jq

# Get supported pools
curl http://localhost:8080/api/v1/pools | jq

# Get statistics
curl http://localhost:8080/api/v1/stats | jq
```

#### Using HTTPie (more user-friendly)

```bash
# Install HTTPie
pip install httpie

# Get relayer info
http GET localhost:8080/api/v1/info

# Submit order
http POST localhost:8080/api/v1/orders \
  transaction="base64_encoded_transaction" \
  poolId="BhPUKnKuzpEYNhSSNxkze51tMVza25rgXfEv5LWgGng2" \
  amountIn="1000000000" \
  minAmountOut="950000000" \
  isBaseInput=true \
  userPublicKey="9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM"
```

### Testing with Node.js

```javascript
// test-relayer-connection.js
const fetch = require('node-fetch');

async function testRelayer() {
  const RELAYER_URL = 'http://localhost:8080';
  
  // Test health
  const health = await fetch(`${RELAYER_URL}/health`).then(r => r.json());
  console.log('Health:', health);
  
  // Test info
  const info = await fetch(`${RELAYER_URL}/api/v1/info`).then(r => r.json());
  console.log('Info:', info);
  
  // Test order submission
  const order = await fetch(`${RELAYER_URL}/api/v1/orders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      transaction: Buffer.from('test').toString('base64'),
      poolId: 'test-pool',
      amountIn: '1000000000',
      minAmountOut: '950000000',
      isBaseInput: true,
      userPublicKey: 'test-user'
    })
  }).then(r => r.json());
  console.log('Order:', order);
}

testRelayer().catch(console.error);
```

## Client Integration Example

### JavaScript/TypeScript Client

```typescript
import { Connection, Transaction, PublicKey } from '@solana/web3.js';
import { BN } from '@coral-xyz/anchor';

class ContinuumRelayerClient {
  constructor(private relayerUrl: string) {}

  async checkHealth() {
    const response = await fetch(`${this.relayerUrl}/health`);
    return response.json();
  }

  async getInfo() {
    const response = await fetch(`${this.relayerUrl}/api/v1/info`);
    return response.json();
  }

  async submitOrder(params: {
    transaction: Transaction;
    poolId: PublicKey;
    amountIn: BN;
    minAmountOut: BN;
    isBaseInput: boolean;
    userPublicKey: PublicKey;
  }) {
    const response = await fetch(`${this.relayerUrl}/api/v1/orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        transaction: params.transaction.serialize().toString('base64'),
        poolId: params.poolId.toBase58(),
        amountIn: params.amountIn.toString(),
        minAmountOut: params.minAmountOut.toString(),
        isBaseInput: params.isBaseInput,
        userPublicKey: params.userPublicKey.toBase58()
      })
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Relayer error: ${response.status} - ${error}`);
    }

    return response.json();
  }

  async getOrderStatus(orderId: string) {
    const response = await fetch(`${this.relayerUrl}/api/v1/orders/${orderId}`);
    if (!response.ok) {
      throw new Error(`Failed to get order status: ${response.statusText}`);
    }
    return response.json();
  }

  subscribeToOrder(orderId: string): WebSocket {
    const ws = new WebSocket(
      `${this.relayerUrl.replace('http', 'ws')}/ws/orders/${orderId}`
    );
    return ws;
  }

  async waitForExecution(orderId: string, timeoutMs = 30000): Promise<any> {
    return new Promise((resolve, reject) => {
      const ws = this.subscribeToOrder(orderId);
      const timeout = setTimeout(() => {
        ws.close();
        reject(new Error('Order execution timeout'));
      }, timeoutMs);

      ws.on('message', (data) => {
        const update = JSON.parse(data.toString());
        if (update.status === 'executed') {
          clearTimeout(timeout);
          ws.close();
          resolve(update);
        } else if (update.status === 'failed') {
          clearTimeout(timeout);
          ws.close();
          reject(new Error(update.error || 'Order execution failed'));
        }
      });

      ws.on('error', (error) => {
        clearTimeout(timeout);
        reject(error);
      });
    });
  }
}

// Usage example
async function main() {
  const client = new ContinuumRelayerClient('http://localhost:8080');
  
  // Check if relayer is healthy
  const health = await client.checkHealth();
  console.log('Relayer health:', health);
  
  // Get relayer info
  const info = await client.getInfo();
  console.log('Relayer address:', info.relayerAddress);
  console.log('Supported pools:', info.supportedPools);
  
  // Submit an order (example with dummy transaction)
  const connection = new Connection('http://localhost:8899');
  const transaction = new Transaction();
  // ... add your Continuum order instruction to transaction
  
  const result = await client.submitOrder({
    transaction,
    poolId: new PublicKey('BhPUKnKuzpEYNhSSNxkze51tMVza25rgXfEv5LWgGng2'),
    amountIn: new BN(1000000000),
    minAmountOut: new BN(950000000),
    isBaseInput: true,
    userPublicKey: wallet.publicKey
  });
  
  console.log('Order submitted:', result.orderId);
  console.log('Estimated execution time:', result.estimatedExecutionTime);
  
  // Wait for execution
  try {
    const execution = await client.waitForExecution(result.orderId);
    console.log('Order executed!');
    console.log('Transaction signature:', execution.signature);
    console.log('Actual amount out:', execution.actualAmountOut);
  } catch (error) {
    console.error('Order failed:', error);
  }
}
```

### React Integration Example

```tsx
import { useState, useEffect } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';

function SwapComponent() {
  const wallet = useWallet();
  const [relayerStatus, setRelayerStatus] = useState(null);
  const [orderStatus, setOrderStatus] = useState(null);
  
  const RELAYER_URL = process.env.REACT_APP_RELAYER_URL || 'http://localhost:8080';
  
  // Check relayer status on mount
  useEffect(() => {
    fetch(`${RELAYER_URL}/health`)
      .then(res => res.json())
      .then(data => setRelayerStatus(data))
      .catch(err => console.error('Relayer offline:', err));
  }, []);
  
  const submitOrder = async () => {
    try {
      // Build your transaction here
      const transaction = await buildContinuumTransaction();
      
      // Sign with wallet
      const signedTx = await wallet.signTransaction(transaction);
      
      // Submit to relayer
      const response = await fetch(`${RELAYER_URL}/api/v1/orders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          transaction: signedTx.serialize().toString('base64'),
          poolId: poolId.toBase58(),
          amountIn: amountIn.toString(),
          minAmountOut: minAmountOut.toString(),
          isBaseInput: true,
          userPublicKey: wallet.publicKey.toBase58()
        })
      });
      
      const result = await response.json();
      setOrderStatus({ status: 'pending', ...result });
      
      // Monitor order via WebSocket
      const ws = new WebSocket(
        `${RELAYER_URL.replace('http', 'ws')}/ws/orders/${result.orderId}`
      );
      
      ws.onmessage = (event) => {
        const update = JSON.parse(event.data);
        setOrderStatus(update);
        
        if (update.status === 'executed' || update.status === 'failed') {
          ws.close();
        }
      };
      
    } catch (error) {
      console.error('Order submission failed:', error);
      setOrderStatus({ status: 'error', error: error.message });
    }
  };
  
  return (
    <div>
      <div>
        Relayer Status: {relayerStatus?.status || 'Unknown'}
      </div>
      
      <button onClick={submitOrder} disabled={!wallet.connected}>
        Submit Order
      </button>
      
      {orderStatus && (
        <div>
          Order Status: {orderStatus.status}
          {orderStatus.signature && (
            <a href={`https://solscan.io/tx/${orderStatus.signature}`}>
              View Transaction
            </a>
          )}
        </div>
      )}
    </div>
  );
}
```

## Deployment Options

### Option 1: Standalone

```bash
# Development
npm run dev

# Production
npm run build
npm start
```

### Option 2: PM2 (Recommended for Production)

```bash
# Start with PM2
RELAYER_MODE=pm2 ./start-relayer.sh start

# View logs
pm2 logs continuum-relayer

# Monitor
pm2 monit
```

### Option 3: Docker

```bash
# Build and run
docker-compose up -d

# View logs
docker-compose logs -f relayer

# Stop
docker-compose down
```

### Option 4: Kubernetes

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: continuum-relayer
spec:
  replicas: 3
  selector:
    matchLabels:
      app: continuum-relayer
  template:
    metadata:
      labels:
        app: continuum-relayer
    spec:
      containers:
      - name: relayer
        image: continuum/relayer:latest
        ports:
        - containerPort: 8080
        env:
        - name: NODE_ENV
          value: "production"
        envFrom:
        - secretRef:
            name: relayer-secrets
        livenessProbe:
          httpGet:
            path: /health
            port: 8080
          initialDelaySeconds: 30
          periodSeconds: 10
```

## Monitoring and Observability

### Prometheus Metrics

The relayer exposes metrics at `/metrics` when `ENABLE_METRICS=true`:

- `continuum_orders_total` - Total orders processed
- `continuum_orders_success` - Successful executions
- `continuum_orders_failed` - Failed executions
- `continuum_execution_time` - Order execution time histogram
- `continuum_queue_size` - Current queue size

### Grafana Dashboard

Import the provided dashboard from `grafana/dashboards/relayer.json` for visualization.

### Logging

Logs are written to:
- Console (with colors in development)
- `logs/relayer.log` (JSON format in production)

Configure log level with `LOG_LEVEL` environment variable (debug, info, warn, error).

## Security Considerations

1. **Keep your relayer keypair secure** - Never commit it to version control
2. **Use HTTPS in production** - Deploy behind a reverse proxy (nginx, Cloudflare)
3. **Configure CORS properly** - Set `ALLOWED_ORIGINS` to specific domains
4. **Monitor for anomalies** - Set up alerts for unusual activity
5. **Regular updates** - Keep dependencies updated for security patches

## Performance Tuning

### Configuration Options

```env
# Increase for higher throughput
MAX_CONCURRENT_EXECUTIONS=10

# Decrease for lower latency
POLL_INTERVAL_MS=500

# Adjust based on network conditions
RETRY_ATTEMPTS=5
RETRY_DELAY_MS=2000

# Connection pooling
CONNECTION_POOL_SIZE=10
PREFLIGHT_COMMITMENT=processed
```

### Scaling Horizontally

Run multiple relayer instances with a load balancer:

```nginx
upstream relayers {
    least_conn;
    server relayer1:8080;
    server relayer2:8080;
    server relayer3:8080;
}

server {
    listen 443 ssl http2;
    server_name relayer.continuum.fi;
    
    location / {
        proxy_pass http://relayers;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
```

## Troubleshooting

### Connection Issues

#### Cannot Connect to Relayer

```bash
# 1. Check if the service is running
ps aux | grep "node.*server.js"

# 2. Check if port 8080 is listening
netstat -tlnp | grep 8080
# or
lsof -i :8080

# 3. Test local connectivity
curl -v http://localhost:8080/health

# 4. Check firewall rules
sudo ufw status
# If firewall is blocking, allow port 8080:
sudo ufw allow 8080

# 5. Check logs
tail -f server.log
# or if using PM2:
pm2 logs continuum-relayer
```

#### WebSocket Connection Issues

```javascript
// Test WebSocket with Node.js
const WebSocket = require('ws');
const ws = new WebSocket('ws://localhost:8080/ws/orders/test');

ws.on('open', () => {
  console.log('Connected!');
  ws.close();
});

ws.on('error', (error) => {
  console.error('WebSocket error:', error);
});
```

#### CORS Issues

If connecting from a browser and getting CORS errors:

1. Update `.env` file:
```env
ALLOWED_ORIGINS=http://localhost:3000,https://yourapp.com
```

2. Or allow all origins (development only):
```env
ALLOWED_ORIGINS=*
```

3. Restart the relayer after changing configuration

### Common Issues

1. **"Insufficient balance"**
   ```bash
   # Check relayer balance
   solana balance $(cat relayer-keypair.json | solana address)
   
   # Fund the relayer
   solana airdrop 1 $(cat relayer-keypair.json | solana address)
   ```

2. **"Transaction simulation failed"**
   - Verify program IDs match your deployment:
   ```bash
   # Check your .env file
   grep PROGRAM_ID .env
   ```
   - Ensure RPC endpoint is accessible:
   ```bash
   curl -X POST http://localhost:8899 -H "Content-Type: application/json" \
     -d '{"jsonrpc":"2.0","id":1,"method":"getHealth"}'
   ```

3. **"Port already in use"**
   ```bash
   # Find process using port 8080
   lsof -i :8080
   # Kill the process
   kill -9 <PID>
   ```

4. **"Connection refused"**
   - Check if relayer is running
   - Verify correct port in .env
   - Check localhost vs 127.0.0.1 vs 0.0.0.0

5. **High latency**
   - Use a dedicated RPC node
   - Deploy relayer geographically close to RPC
   - Tune performance settings:
   ```env
   POLL_INTERVAL_MS=500
   MAX_CONCURRENT_EXECUTIONS=10
   ```

### Debug Mode

Enable verbose logging:

```env
LOG_LEVEL=debug
DEBUG=continuum:*
```

View detailed logs:
```bash
# If running directly
tail -f logs/relayer.log | jq

# If using PM2
pm2 logs continuum-relayer --lines 100

# If using Docker
docker-compose logs -f relayer --tail=100
```

### Testing Relayer Response

Create a test script `test-relayer.sh`:

```bash
#!/bin/bash

RELAYER_URL="http://localhost:8080"

echo "Testing Relayer at $RELAYER_URL"
echo "================================"

# Test health
echo -n "Health check: "
STATUS=$(curl -s -o /dev/null -w "%{http_code}" $RELAYER_URL/health)
if [ $STATUS -eq 200 ]; then
    echo "✅ OK"
else
    echo "❌ Failed (HTTP $STATUS)"
fi

# Test API info
echo -n "API info: "
INFO=$(curl -s $RELAYER_URL/api/v1/info | jq -r .relayerAddress)
if [ ! -z "$INFO" ]; then
    echo "✅ OK (Relayer: $INFO)"
else
    echo "❌ Failed"
fi

# Test WebSocket
echo -n "WebSocket: "
timeout 2 wscat -c ws://localhost:8080/ws/orders/test 2>&1 | grep -q "Connected" && echo "✅ OK" || echo "❌ Failed"

echo "================================"
```

Make it executable:
```bash
chmod +x test-relayer.sh
./test-relayer.sh
```

## Support

- Documentation: https://docs.continuum.fi
- Discord: https://discord.gg/continuum
- Issues: https://github.com/continuum-finance/relayer/issues

## License

MIT License - see LICENSE file for details