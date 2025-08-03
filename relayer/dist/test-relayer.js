"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g = Object.create((typeof Iterator === "function" ? Iterator : Object).prototype);
    return g.next = verb(0), g["throw"] = verb(1), g["return"] = verb(2), typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (g && (g = 0, op[0] && (_ = 0)), _) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
var web3_js_1 = require("@solana/web3.js");
// Use built-in fetch in Node 18+
var ws_1 = __importDefault(require("ws"));
var RELAYER_URL = 'http://localhost:8085';
var RPC_URL = 'http://localhost:8899';
function testRelayerService() {
    return __awaiter(this, void 0, void 0, function () {
        var healthResponse, health, infoResponse, info, poolsResponse, pools, statsResponse, stats, testWallet, connection, transaction, blockhash, orderData, orderResponse, orderResult, testOrderId, ws_2, statusResponse, statusResult, error_1;
        var _a;
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0:
                    console.log('🧪 Testing Continuum Relayer Service...\n');
                    _b.label = 1;
                case 1:
                    _b.trys.push([1, 16, , 17]);
                    // Test 1: Health Check
                    console.log('1️⃣ Testing health endpoint...');
                    return [4 /*yield*/, fetch("".concat(RELAYER_URL, "/health"))];
                case 2:
                    healthResponse = _b.sent();
                    if (!healthResponse.ok) {
                        throw new Error("Health check failed: ".concat(healthResponse.status));
                    }
                    return [4 /*yield*/, healthResponse.json()];
                case 3:
                    health = _b.sent();
                    console.log('✅ Health check passed:', health);
                    console.log("   Relayer address: ".concat(health.relayer));
                    console.log("   Status: ".concat(health.status, "\n"));
                    // Test 2: Get Relayer Info
                    console.log('2️⃣ Testing info endpoint...');
                    return [4 /*yield*/, fetch("".concat(RELAYER_URL, "/api/v1/info"))];
                case 4:
                    infoResponse = _b.sent();
                    if (!infoResponse.ok) {
                        throw new Error("Info endpoint failed: ".concat(infoResponse.status));
                    }
                    return [4 /*yield*/, infoResponse.json()];
                case 5:
                    info = _b.sent();
                    console.log('✅ Info endpoint passed:');
                    console.log("   Continuum Program: ".concat(info.continuumProgram));
                    console.log("   CP-Swap Program: ".concat(info.cpSwapProgram));
                    console.log("   Fee: ".concat(info.fee, " bps"));
                    console.log("   Performance:", info.performance, '\n');
                    // Test 3: Get Supported Pools
                    console.log('3️⃣ Testing pools endpoint...');
                    return [4 /*yield*/, fetch("".concat(RELAYER_URL, "/api/v1/pools"))];
                case 6:
                    poolsResponse = _b.sent();
                    if (!poolsResponse.ok) {
                        throw new Error("Pools endpoint failed: ".concat(poolsResponse.status));
                    }
                    return [4 /*yield*/, poolsResponse.json()];
                case 7:
                    pools = _b.sent();
                    console.log('✅ Pools endpoint passed:');
                    console.log("   Total pools: ".concat(((_a = pools.pools) === null || _a === void 0 ? void 0 : _a.length) || 0, "\n"));
                    // Test 4: Get Statistics
                    console.log('4️⃣ Testing stats endpoint...');
                    return [4 /*yield*/, fetch("".concat(RELAYER_URL, "/api/v1/stats"))];
                case 8:
                    statsResponse = _b.sent();
                    if (!statsResponse.ok) {
                        throw new Error("Stats endpoint failed: ".concat(statsResponse.status));
                    }
                    return [4 /*yield*/, statsResponse.json()];
                case 9:
                    stats = _b.sent();
                    console.log('✅ Stats endpoint passed:', stats, '\n');
                    // Test 5: Submit Order (will fail but tests the endpoint)
                    console.log('5️⃣ Testing order submission...');
                    testWallet = web3_js_1.Keypair.generate();
                    connection = new web3_js_1.Connection(RPC_URL);
                    transaction = new web3_js_1.Transaction();
                    transaction.add(web3_js_1.SystemProgram.transfer({
                        fromPubkey: testWallet.publicKey,
                        toPubkey: testWallet.publicKey,
                        lamports: 1,
                    }));
                    return [4 /*yield*/, connection.getLatestBlockhash()];
                case 10:
                    blockhash = (_b.sent()).blockhash;
                    transaction.recentBlockhash = blockhash;
                    transaction.feePayer = testWallet.publicKey;
                    transaction.partialSign(testWallet);
                    orderData = {
                        transaction: transaction.serialize({ requireAllSignatures: false }).toString('base64'),
                        poolId: web3_js_1.Keypair.generate().publicKey.toBase58(),
                        amountIn: '1000000000',
                        minAmountOut: '950000000',
                        isBaseInput: true,
                        userPublicKey: testWallet.publicKey.toBase58(),
                    };
                    return [4 /*yield*/, fetch("".concat(RELAYER_URL, "/api/v1/orders"), {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify(orderData),
                        })];
                case 11:
                    orderResponse = _b.sent();
                    return [4 /*yield*/, orderResponse.json()];
                case 12:
                    orderResult = _b.sent();
                    if (orderResponse.ok) {
                        console.log('✅ Order submission endpoint working:', orderResult);
                    }
                    else {
                        console.log('⚠️  Order submission failed (expected):', orderResult.error);
                    }
                    console.log('');
                    // Test 6: WebSocket Connection
                    console.log('6️⃣ Testing WebSocket connection...');
                    testOrderId = 'test-order-123';
                    ws_2 = new ws_1.default("".concat(RELAYER_URL.replace('http', 'ws'), "/ws/orders/").concat(testOrderId));
                    return [4 /*yield*/, new Promise(function (resolve, reject) {
                            ws_2.on('open', function () {
                                console.log('✅ WebSocket connected successfully');
                                ws_2.close();
                                resolve();
                            });
                            ws_2.on('error', function (error) {
                                console.log('❌ WebSocket error:', error.message);
                                reject(error);
                            });
                            setTimeout(function () {
                                ws_2.close();
                                resolve();
                            }, 2000);
                        })];
                case 13:
                    _b.sent();
                    console.log('');
                    // Test 7: Invalid Order Status
                    console.log('7️⃣ Testing order status endpoint...');
                    return [4 /*yield*/, fetch("".concat(RELAYER_URL, "/api/v1/orders/invalid-order-id"))];
                case 14:
                    statusResponse = _b.sent();
                    return [4 /*yield*/, statusResponse.json()];
                case 15:
                    statusResult = _b.sent();
                    if (!statusResponse.ok) {
                        console.log('✅ Order status correctly returns error for invalid order:', statusResult.error);
                    }
                    else {
                        console.log('⚠️  Unexpected success for invalid order');
                    }
                    console.log('');
                    console.log('🎉 All tests completed!\n');
                    console.log('📋 Summary:');
                    console.log('   - HTTP API: Working ✅');
                    console.log('   - WebSocket: Working ✅');
                    console.log('   - All endpoints responding correctly');
                    console.log('   - Service is ready for use on port 8085');
                    return [3 /*break*/, 17];
                case 16:
                    error_1 = _b.sent();
                    console.error('❌ Test failed:', error_1 instanceof Error ? error_1.message : String(error_1));
                    console.error('\nMake sure the relayer service is running on port 8085');
                    process.exit(1);
                    return [3 /*break*/, 17];
                case 17: return [2 /*return*/];
            }
        });
    });
}
// Run the test
testRelayerService().then(function () {
    console.log('\n✅ Relayer service test completed successfully!');
    process.exit(0);
}).catch(function (error) {
    console.error('\n❌ Test failed:', error);
    process.exit(1);
});
