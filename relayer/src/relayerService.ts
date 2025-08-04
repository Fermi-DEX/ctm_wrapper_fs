import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  VersionedTransaction,
  Commitment,
  ComputeBudgetProgram,
  TransactionInstruction,
  SystemProgram,
} from "@solana/web3.js";
import { BN } from "@coral-xyz/anchor";
import { EventEmitter } from "events";
import winston from "winston";
import { createExecuteOrderInstruction } from "@continuum/cp-swap-sdk";
import { config as relayerConfig } from "./config";
import {
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";

interface OrderSubmission {
  transaction?: Transaction | VersionedTransaction;
  poolId: PublicKey;
  amountIn: string;
  minAmountOut: string;
  isBaseInput: boolean;
  userPublicKey: PublicKey;
}

interface CreateOrderParams {
  poolId: string;
  amountIn: string;
  minAmountOut: string;
  isBaseInput: boolean;
  userPublicKey: string;
  userTokenA: string;
  userTokenB: string;
}

interface CreateOrderResult {
  orderId: string;
  orderPda: PublicKey;
  sequence: BN;
  estimatedExecutionTime: number;
  fee: string;
  transactionBase64: string;
}

interface OrderResult {
  orderId: string;
  orderPda: PublicKey;
  sequence: BN;
  estimatedExecutionTime: number;
  fee: string;
}

interface OrderStatus {
  orderId: string;
  status: "pending" | "executed" | "failed" | "cancelled";
  sequence: string;
  poolId: string;
  userPublicKey: string;
  amountIn: string;
  minAmountOut: string;
  isBaseInput: boolean;
  transaction?: Transaction | VersionedTransaction;
  actualAmountOut?: string;
  executionPrice?: number;
  signature?: string;
  executedAt?: string;
  error?: string;
}

interface PoolInfo {
  poolId: string;
  token0: string;
  token1: string;
  fee: number;
  liquidity: string;
  volume24h: string;
  isActive: boolean;
}

export class RelayerService extends EventEmitter {
  private orders: Map<string, OrderStatus> = new Map();
  private executionQueue: string[] = [];
  private isRunning = false;
  private stats = {
    totalOrders: 0,
    successfulOrders: 0,
    failedOrders: 0,
    totalExecutionTime: 0,
  };

  constructor(
    private connection: Connection,
    private relayerWallet: Keypair,
    private continuumProgramId: PublicKey,
    private cpSwapProgramId: PublicKey,
    private logger: winston.Logger
  ) {
    super();
  }

  async start() {
    this.isRunning = true;
    this.logger.info("Relayer service started");

    // Start execution loop
    this.executionLoop();
  }

  async stop() {
    this.isRunning = false;
    this.logger.info("Relayer service stopped");
  }

  async submitOrder(params: OrderSubmission): Promise<OrderResult> {
    const orderId = `ord_${Date.now()}_${Math.random()
      .toString(36)
      .substr(2, 9)}`;
    const sequence = new BN(this.stats.totalOrders + 1);

    // Log incoming transaction details
    if (params.transaction) {
      const tx = params.transaction;
      this.logger.info("Received transaction in submitOrder", {
        orderId,
        transactionType:
          tx instanceof VersionedTransaction
            ? "VersionedTransaction"
            : "Transaction",
        hasTransaction: true,
        userPublicKey: params.userPublicKey.toBase58(),
        poolId: params.poolId.toBase58(),
      });

      if (tx instanceof VersionedTransaction) {
        this.logger.info("VersionedTransaction details at submission", {
          orderId,
          signaturesCount: tx.signatures.length,
          nullSignatures: tx.signatures.filter((s) => s === null).length,
          nonNullSignatures: tx.signatures.filter((s) => s !== null).length,
          numRequiredSignatures: tx.message.header.numRequiredSignatures,
          staticAccountKeys: tx.message.staticAccountKeys.map((k) =>
            k.toBase58()
          ),
          firstSignature: tx.signatures[0]
            ? Buffer.from(tx.signatures[0])
                .toString("base64")
                .substring(0, 20) + "..."
            : "null",
        });
      } else {
        this.logger.debug("Legacy Transaction details", {
          orderId,
          signaturesCount: tx.signatures.length,
          feePayer: tx.feePayer?.toBase58(),
          instructions: tx.instructions.length,
          signedBy: tx.signatures
            .filter((s) => s.signature !== null)
            .map((s) => s.publicKey?.toBase58()),
        });
      }
    } else {
      this.logger.warn("No transaction provided in submitOrder", {
        orderId,
        userPublicKey: params.userPublicKey.toBase58(),
        poolId: params.poolId.toBase58(),
      });
    }

    // Create order status
    const orderStatus: OrderStatus = {
      orderId,
      status: "pending",
      sequence: sequence.toString(),
      poolId: params.poolId.toBase58(),
      userPublicKey: params.userPublicKey.toBase58(),
      amountIn: params.amountIn,
      minAmountOut: params.minAmountOut,
      isBaseInput: params.isBaseInput,
      transaction: params.transaction,
    };

    this.orders.set(orderId, orderStatus);
    this.executionQueue.push(orderId);
    this.stats.totalOrders++;

    // Calculate PDA (mock)
    const [orderPda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("order"),
        params.userPublicKey.toBuffer(),
        sequence.toArrayLike(Buffer, "le", 8),
      ],
      this.continuumProgramId
    );

    const result: OrderResult = {
      orderId,
      orderPda,
      sequence,
      estimatedExecutionTime: 5000, // 5 seconds estimate
      fee: "100000", // 0.0001 SOL
    };

    this.logger.info("Order submitted", {
      orderId,
      sequence: sequence.toString(),
      poolId: params.poolId.toBase58(),
    });

    return result;
  }

  async createOrderTransaction(
    params: CreateOrderParams
  ): Promise<CreateOrderResult> {
    const orderId = `ord_${Date.now()}_${Math.random()
      .toString(36)
      .substr(2, 9)}`;
    const sequence = new BN(this.stats.totalOrders + 1);

    // Convert string parameters to required types
    const poolId = new PublicKey(params.poolId);
    const userPublicKey = new PublicKey(params.userPublicKey);
    const amountIn = new BN(params.amountIn);
    const minAmountOut = new BN(params.minAmountOut);

    // Log the conversion details
    this.logger.info("Parameter conversion details", {
      orderId,
      amountIn_string: params.amountIn,
      amountIn_BN: amountIn.toString(),
      amountIn_hex: amountIn.toString(16),
      minAmountOut_string: params.minAmountOut,
      minAmountOut_BN: minAmountOut.toString(),
      minAmountOut_hex: minAmountOut.toString(16),
    });

    this.logger.info("Building transaction for order", {
      orderId,
      poolId: params.poolId,
      userPublicKey: params.userPublicKey,
      amountIn: params.amountIn,
      minAmountOut: params.minAmountOut,
      isBaseInput: params.isBaseInput,
      userTokenA: params.userTokenA,
      userTokenB: params.userTokenB,
    });

    // Find pool config
    const poolConfig = relayerConfig.supportedPools.find(
      (p) => p.poolId === params.poolId
    );
    if (!poolConfig) {
      throw new Error(
        `Pool configuration not found for pool: ${params.poolId}`
      );
    }

    this.logger.debug("Pool configuration found", {
      orderId,
      poolId: params.poolId,
      configTokenA: poolConfig.tokenAMint,
      configTokenB: poolConfig.tokenBMint,
      configTokenASymbol: poolConfig.tokenASymbol,
      configTokenBSymbol: poolConfig.tokenBSymbol,
    });

    // Build the swap instruction with provided token accounts
    const swapIx = await this.buildSwapImmediateInstruction(
      poolId,
      userPublicKey,
      amountIn,
      minAmountOut,
      params.isBaseInput,
      poolConfig,
      new PublicKey(params.userTokenA),
      new PublicKey(params.userTokenB)
    );

    // Create transaction and add instruction
    const transaction = new Transaction();
    transaction.add(swapIx);

    // Add priority fee if configured
    if (relayerConfig.priorityFeeLevel !== "none") {
      const priorityFeeMap = {
        low: 10000,
        medium: 50000,
        high: 100000,
      };
      const microLamports = priorityFeeMap[relayerConfig.priorityFeeLevel];

      transaction.add(
        ComputeBudgetProgram.setComputeUnitPrice({
          microLamports,
        })
      );
    }

    // Set fee payer and recent blockhash
    transaction.feePayer = userPublicKey;
    const { blockhash } = await this.connection.getLatestBlockhash();
    transaction.recentBlockhash = blockhash;

    // Partially sign with relayer (if relayer needs to sign)
    // Note: Check if relayer is a required signer
    const requiresRelayerSignature = transaction.instructions.some((ix) =>
      ix.keys.some(
        (key) => key.pubkey.equals(this.relayerWallet.publicKey) && key.isSigner
      )
    );

    if (requiresRelayerSignature) {
      transaction.partialSign(this.relayerWallet);
      this.logger.debug("Transaction partially signed by relayer", { orderId });
    } else {
      this.logger.debug("Relayer signature not required for this transaction", {
        orderId,
      });
    }

    // Serialize transaction to base64
    const transactionBase64 = Buffer.from(
      transaction.serialize({
        requireAllSignatures: false,
        verifySignatures: false,
      })
    ).toString("base64");

    // Calculate PDA for order
    const [orderPda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("order"),
        userPublicKey.toBuffer(),
        sequence.toArrayLike(Buffer, "le", 8),
      ],
      this.continuumProgramId
    );

    // Store order for tracking (without transaction since it will be signed by frontend)
    const orderStatus: OrderStatus = {
      orderId,
      status: "pending",
      sequence: sequence.toString(),
      poolId: params.poolId,
      userPublicKey: params.userPublicKey,
      amountIn: params.amountIn,
      minAmountOut: params.minAmountOut,
      isBaseInput: params.isBaseInput,
      // Don't store transaction here - frontend will sign and broadcast
    };

    this.orders.set(orderId, orderStatus);
    this.stats.totalOrders++;

    this.logger.info("Transaction created and partially signed", {
      orderId,
      sequence: sequence.toString(),
      poolId: params.poolId,
      requiresRelayerSignature,
      transactionSize: transactionBase64.length,
    });

    const result: CreateOrderResult = {
      orderId,
      orderPda,
      sequence,
      estimatedExecutionTime: 5000,
      fee: "100000",
      transactionBase64,
    };

    return result;
  }

  async getOrderStatus(orderId: string): Promise<OrderStatus | null> {
    return this.orders.get(orderId) || null;
  }

  async cancelOrder(
    orderId: string,
    signature: string
  ): Promise<{ refund: string }> {
    const order = this.orders.get(orderId);

    if (!order) {
      throw new Error("Order not found");
    }

    if (order.status !== "pending") {
      throw new Error("Can only cancel pending orders");
    }

    // TODO: Verify signature

    order.status = "cancelled";

    // Remove from execution queue
    const index = this.executionQueue.indexOf(orderId);
    if (index > -1) {
      this.executionQueue.splice(index, 1);
    }

    return { refund: "0" }; // No refund in this mock
  }

  getSupportedPools(): string[] {
    return relayerConfig.supportedPools.map((pool) => pool.poolId);
  }

  async getSupportedPoolsWithInfo(): Promise<PoolInfo[]> {
    return relayerConfig.supportedPools.map((pool) => ({
      poolId: pool.poolId,
      token0: pool.tokenAMint,
      token1: pool.tokenBMint,
      fee: 0.0025, // 0.25% fee
      liquidity: "1000000000000", // Placeholder
      volume24h: "0", // Placeholder
      isActive: true,
    }));
  }

  getSuccessRate(): number {
    if (this.stats.totalOrders === 0) return 1;
    return this.stats.successfulOrders / this.stats.totalOrders;
  }

  getAvgExecutionTime(): number {
    if (this.stats.successfulOrders === 0) return 0;
    return this.stats.totalExecutionTime / this.stats.successfulOrders;
  }

  getTotalOrders(): number {
    return this.stats.totalOrders;
  }

  async getStatistics() {
    return {
      totalOrders: this.stats.totalOrders,
      successfulOrders: this.stats.successfulOrders,
      failedOrders: this.stats.failedOrders,
      successRate: this.getSuccessRate(),
      avgExecutionTime: this.getAvgExecutionTime(),
      pendingOrders: this.executionQueue.length,
      relayerBalance:
        (await this.connection.getBalance(this.relayerWallet.publicKey)) / 1e9,
    };
  }

  private async executionLoop() {
    while (this.isRunning) {
      if (this.executionQueue.length > 0) {
        const orderId = this.executionQueue.shift()!;
        await this.executeOrder(orderId);
      }

      // Wait before next check
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }

  private async executeOrder(orderId: string) {
    const order = this.orders.get(orderId);
    if (!order || order.status !== "pending") return;

    const startTime = Date.now();

    try {
      this.logger.info("Executing order", {
        orderId,
        sequence: order.sequence,
        userPublicKey: order.userPublicKey,
        poolId: order.poolId,
        amountIn: order.amountIn,
      });

      // // Use mock mode for localnet or if explicitly enabled
      // if (relayerConfig.enableMockMode && !relayerConfig.isDevnet) {
      //   await new Promise(resolve => setTimeout(resolve, 2000));

      //   const signature = 'mock_' + Math.random().toString(36).substr(2, 9);
      //   order.status = 'executed';
      //   order.signature = signature;
      //   order.actualAmountOut = (parseInt(order.amountIn) * 0.98).toString();
      //   order.executionPrice = 0.98;
      //   order.executedAt = new Date().toISOString();

      //   const executionTime = Date.now() - startTime;
      //   this.stats.successfulOrders++;
      //   this.stats.totalExecutionTime += executionTime;

      //   this.logger.info('Order executed (mock)', {
      //     orderId,
      //     signature,
      //     executionTime,
      //   });

      //   this.emit('orderExecuted', orderId, {
      //     signature,
      //     executionPrice: order.executionPrice,
      //     actualAmountOut: order.actualAmountOut,
      //   });

      //   return;
      // }

      // Use the pre-signed transaction from the user
      if (!order.transaction) {
        throw new Error(
          "No transaction found in order - user must provide signed transaction"
        );
      }

      const transaction = order.transaction;

      this.logger.info("Using pre-signed transaction", {
        orderId,
        transactionType:
          transaction instanceof VersionedTransaction
            ? "VersionedTransaction"
            : "Transaction",
        userPublicKey: order.userPublicKey,
        poolId: order.poolId,
      });

      // For VersionedTransaction, add relayer signature
      if (transaction instanceof VersionedTransaction) {
        // Check if relayer needs to sign (shouldn't for user-signed transactions)
        this.logger.info("Processing VersionedTransaction", {
          orderId,
          signaturesCount: transaction.signatures.length,
          messageKeys: transaction.message.staticAccountKeys.map((k) =>
            k.toBase58()
          ),
        });

        // Log detailed signature information
        // Log signature details at info level for debugging
        this.logger.info("VersionedTransaction signature details", {
          orderId,
          signatures: transaction.signatures.map((sig, idx) => ({
            index: idx,
            isNull: sig === null,
            length: sig ? sig.length : 0,
            base58: sig
              ? Buffer.from(sig).toString("base64").substring(0, 20) + "..."
              : "null",
          })),
          feePayer: transaction.message.staticAccountKeys[0]?.toBase58(),
          numRequiredSignatures:
            transaction.message.header.numRequiredSignatures,
          numReadonlySignedAccounts:
            transaction.message.header.numReadonlySignedAccounts,
          numReadonlyUnsignedAccounts:
            transaction.message.header.numReadonlyUnsignedAccounts,
        });

        // Check which accounts need signatures
        const requiredSigners = transaction.message.staticAccountKeys
          .slice(0, transaction.message.header.numRequiredSignatures)
          .map((k) => k.toBase58());

        this.logger.info("Required signers for transaction", {
          orderId,
          requiredSigners,
          relayerPublicKey: this.relayerWallet.publicKey.toBase58(),
          relayerIsRequired: requiredSigners.includes(
            this.relayerWallet.publicKey.toBase58()
          ),
        });
      } else {
        // For legacy Transaction, add relayer signature if needed
        this.logger.info("Processing legacy Transaction", {
          orderId,
          signaturesCount: transaction.signatures.length,
          feePayer: transaction.feePayer?.toBase58(),
          instructionCount: transaction.instructions.length,
        });

        // Log detailed signature information for legacy transaction
        this.logger.info("Legacy Transaction signature details", {
          orderId,
          signatures: transaction.signatures.map((sig, idx) => ({
            index: idx,
            publicKey: sig.publicKey?.toBase58() || "null",
            signature: sig.signature
              ? Buffer.from(sig.signature).toString("base64").substring(0, 20) +
                "..."
              : "null",
          })),
          requiredSigners: transaction.instructions
            .flatMap((ix) =>
              ix.keys.filter((k) => k.isSigner).map((k) => k.pubkey.toBase58())
            )
            .filter((v, i, a) => a.indexOf(v) === i), // unique signers
          relayerIsRequired: transaction.instructions.some((ix) =>
            ix.keys.some(
              (k) => k.isSigner && k.pubkey.equals(this.relayerWallet.publicKey)
            )
          ),
        });
      }

      this.logger.info("Sending pre-signed transaction", {
        orderId,
        transactionType:
          transaction instanceof VersionedTransaction
            ? "VersionedTransaction"
            : "Transaction",
        feePayer:
          transaction instanceof VersionedTransaction
            ? transaction.message.staticAccountKeys[0]?.toBase58()
            : transaction.feePayer?.toBase58() || "none",
      });

      // Log transaction details before sending
      this.logger.info("Transaction details before sending", {
        orderId,
        instructionCount: transaction instanceof VersionedTransaction 
          ? transaction.message.compiledInstructions.length 
          : transaction.instructions.length,
      });

      // Log instruction data for debugging
      if (transaction instanceof VersionedTransaction) {
        transaction.message.compiledInstructions.forEach((ix, index) => {
          this.logger.info("Instruction data", {
            orderId,
            instructionIndex: index,
            programIdIndex: ix.programIdIndex,
            data: Buffer.from(ix.data).toString("hex"),
            dataLength: ix.data.length,
          });
        });
      } else {
        transaction.instructions.forEach((ix, index) => {
          this.logger.info("Instruction data", {
            orderId,
            instructionIndex: index,
            programId: ix.programId.toBase58(),
            data: ix.data.toString("hex"),
            dataLength: ix.data.length,
          });
        });
      }

      // Send the pre-signed transaction (no additional signers needed)
      let signature: string;
      try {
        if (transaction instanceof VersionedTransaction) {
          // Check if relayer needs to sign
          
          const relayerIndex = transaction.message.staticAccountKeys
            .findIndex(k => k.equals(this.relayerWallet.publicKey));
          
          const relayerNeedsToSign = relayerIndex !== -1 && 
            relayerIndex < transaction.message.header.numRequiredSignatures;
          
          if (relayerNeedsToSign) {
            // Check if relayer signature is missing (all zeros)
            const relayerSig = transaction.signatures[relayerIndex];
            const isZeroSig = relayerSig && Buffer.from(relayerSig).every(b => b === 0);
            
            if (isZeroSig || !relayerSig) {
              this.logger.info("Adding relayer signature to transaction", {
                orderId,
                relayerIndex,
                relayerPublicKey: this.relayerWallet.publicKey.toBase58(),
              });
              
              // Sign the transaction with relayer
              transaction.sign([this.relayerWallet]);
            }
          }

          // Verify transaction is fully signed before sending
          const requiredSignatures =
            transaction.message.header.numRequiredSignatures;
          const providedSignatures = transaction.signatures.filter(
            (sig) => sig !== null && !Buffer.from(sig).every(b => b === 0)
          ).length;

          this.logger.info("Pre-send verification", {
            orderId,
            requiredSignatures,
            providedSignatures,
            isFullySigned: providedSignatures >= requiredSignatures,
          });

          signature = await this.connection.sendTransaction(transaction, {
            skipPreflight: false,
            preflightCommitment: "confirmed",
          });
        } else {
          // For legacy transaction, check signatures
          const requiredSigners = new Set<string>();
          transaction.instructions.forEach((ix) => {
            ix.keys.forEach((k) => {
              if (k.isSigner) requiredSigners.add(k.pubkey.toBase58());
            });
          });

          const providedSigners = transaction.signatures
            .filter((sig) => sig.signature !== null)
            .map((sig) => sig.publicKey?.toBase58())
            .filter(Boolean);

          this.logger.info("Pre-send verification (legacy)", {
            orderId,
            requiredSigners: Array.from(requiredSigners),
            providedSigners,
            missingSigners: Array.from(requiredSigners).filter(
              (s) => !providedSigners.includes(s)
            ),
          });

          signature = await this.connection.sendRawTransaction(
            transaction.serialize(),
            {
              skipPreflight: false,
              preflightCommitment: "confirmed",
            }
          );
        }
      } catch (sendError) {
        // Enhanced error logging for send failures
        this.logger.error("Transaction send failed", {
          orderId,
          error:
            sendError instanceof Error ? sendError.message : String(sendError),
          errorName: sendError instanceof Error ? sendError.name : "Unknown",
          transactionType:
            transaction instanceof VersionedTransaction
              ? "VersionedTransaction"
              : "Transaction",
        });

        // Try to get more details about the error
        if (
          sendError instanceof Error &&
          sendError.message.includes("signature verification")
        ) {
          this.logger.error("Signature verification failure details", {
            orderId,
            userPublicKey: order.userPublicKey,
            poolId: order.poolId,
            transactionKeys:
              transaction instanceof VersionedTransaction
                ? transaction.message.staticAccountKeys.map((k) => k.toBase58())
                : "legacy transaction",
          });
        }

        throw sendError;
      }

      this.logger.info("Transaction sent", {
        orderId,
        signature,
        status: "confirming",
      });

      // Wait for confirmation
      const latestBlockhash = await this.connection.getLatestBlockhash();
      const confirmationResult = await this.connection.confirmTransaction(
        {
          signature,
          blockhash: latestBlockhash.blockhash,
          lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
        },
        "confirmed"
      );

      this.logger.info("Transaction confirmation result", {
        orderId,
        signature,
        confirmed: !confirmationResult.value.err,
        error: confirmationResult.value.err
          ? JSON.stringify(confirmationResult.value.err)
          : null,
      });

      if (confirmationResult.value.err) {
        this.logger.error("Transaction confirmation failed", {
          orderId,
          signature,
          error: JSON.stringify(confirmationResult.value.err),
          userPublicKey: order.userPublicKey,
        });
        throw new Error(
          `Transaction failed: ${JSON.stringify(confirmationResult.value.err)}`
        );
      }

      // Parse transaction result to get actual output amount
      // In a real implementation, we would parse the transaction logs or account data
      // For now, we'll use the min amount out as a fallback estimation
      const amountIn = parseInt(order.amountIn);
      const minAmountOut = parseInt(order.minAmountOut);

      // Use minAmountOut as actual amount (conservative estimate)
      // In production, you'd parse transaction logs to get the exact amounts
      order.actualAmountOut = order.minAmountOut;
      order.executionPrice = minAmountOut / amountIn;

      order.status = "executed";
      order.signature = signature;
      order.executedAt = new Date().toISOString();

      const executionTime = Date.now() - startTime;
      this.stats.successfulOrders++;
      this.stats.totalExecutionTime += executionTime;

      this.logger.info("Order executed", {
        orderId,
        signature,
        executionTime,
        actualAmountOut: order.actualAmountOut,
      });

      this.emit("orderExecuted", orderId, {
        signature,
        executionPrice: order.executionPrice,
        actualAmountOut: order.actualAmountOut,
      });
    } catch (error) {
      order.status = "failed";
      order.error = error instanceof Error ? error.message : String(error);
      this.stats.failedOrders++;

      // Check if this is a "transaction already processed" error
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      const isAlreadyProcessed =
        errorMessage.includes("This transaction has already been processed") ||
        errorMessage.includes("already been processed");

      if (isAlreadyProcessed) {
        // Try to extract transaction signature from the transaction
        let transactionSignature = "unknown";
        try {
          if (order.transaction) {
            if (order.transaction instanceof VersionedTransaction) {
              // For VersionedTransaction, extract signature from signatures array
              if (
                order.transaction.signatures &&
                order.transaction.signatures.length > 0
              ) {
                // Find the first non-null signature
                const firstSig = order.transaction.signatures.find(
                  (sig) => sig !== null
                );
                if (firstSig) {
                  transactionSignature =
                    Buffer.from(firstSig).toString("base64");
                }
              }
            } else {
              // For legacy Transaction, check signatures array
              if (
                order.transaction.signatures &&
                order.transaction.signatures.length > 0
              ) {
                const firstSig = order.transaction.signatures.find(
                  (sig) => sig && sig.signature
                );
                if (firstSig && firstSig.signature) {
                  transactionSignature = firstSig.signature.toString();
                }
              }
            }
          }
        } catch (sigError) {
          this.logger.debug("Could not extract transaction signature", {
            orderId,
            error: sigError,
          });
        }

        this.logger.warn(
          "Transaction already processed - likely frontend auto-broadcast",
          {
            orderId,
            sequence: order.sequence,
            userPublicKey: order.userPublicKey,
            poolId: order.poolId,
            amountIn: order.amountIn,
            transactionSignature,
            possibleDuplicateReason:
              "Frontend wallet may have auto-broadcast the signed transaction",
            recommendation:
              "Frontend should send unsigned transaction to relayer",
            executionTime: Date.now() - startTime,
          }
        );
      } else {
        this.logger.error("Order execution failed", {
          orderId,
          sequence: order.sequence,
          userPublicKey: order.userPublicKey,
          poolId: order.poolId,
          amountIn: order.amountIn,
          error: errorMessage,
          stack: error instanceof Error ? error.stack : undefined,
          executionTime: Date.now() - startTime,
        });
      }

      this.emit("orderFailed", orderId, error);
    }
  }

  private async buildSwapImmediateInstruction(
    poolId: PublicKey,
    user: PublicKey,
    amountIn: BN,
    minAmountOut: BN,
    isBaseInput: boolean,
    poolConfig: any,
    userTokenA: PublicKey,
    userTokenB: PublicKey
  ): Promise<TransactionInstruction> {
    // Derive PDAs
    const [fifoState] = PublicKey.findProgramAddressSync(
      [Buffer.from("fifo_state")],
      this.continuumProgramId
    );

    const [poolAuthority, poolAuthorityBump] = PublicKey.findProgramAddressSync(
      [Buffer.from("cp_pool_authority"), poolId.toBuffer()],
      this.continuumProgramId
    );

    const [cpSwapAuthority] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault_and_lp_mint_auth_seed")],
      this.cpSwapProgramId
    );

    // Use the provided user token accounts
    const tokenAMint = new PublicKey(poolConfig.tokenAMint);
    const tokenBMint = new PublicKey(poolConfig.tokenBMint);

    // Determine source and destination based on swap direction
    const userSourceToken = isBaseInput ? userTokenA : userTokenB;
    const userDestToken = isBaseInput ? userTokenB : userTokenA;

    this.logger.info("Using provided token accounts", {
      user: user.toBase58(),
      tokenAMint: tokenAMint.toBase58(),
      tokenBMint: tokenBMint.toBase58(),
      userTokenA: userTokenA.toBase58(),
      userTokenB: userTokenB.toBase58(),
      userSourceToken: userSourceToken.toBase58(),
      userDestToken: userDestToken.toBase58(),
      isBaseInput,
      swapDirection: isBaseInput ? "USDC -> WSOL" : "WSOL -> USDC",
    });

    // Build instruction data
    const discriminator = Buffer.from([175, 131, 44, 121, 171, 170, 38, 18]);
    const amountInBuffer = amountIn.toArrayLike(Buffer, "le", 8);
    const minAmountOutBuffer = minAmountOut.toArrayLike(Buffer, "le", 8);
    
    // Log the buffer contents
    this.logger.info("Instruction data encoding", {
      discriminator: discriminator.toString("hex"),
      amountIn_value: amountIn.toString(),
      amountIn_buffer: amountInBuffer.toString("hex"),
      minAmountOut_value: minAmountOut.toString(),
      minAmountOut_buffer: minAmountOutBuffer.toString("hex"),
      isBaseInput,
      poolId: poolId.toBase58(),
    });
    
    const data = Buffer.concat([
      discriminator,
      amountInBuffer,
      minAmountOutBuffer,
      Buffer.from([isBaseInput ? 1 : 0]),
      poolId.toBuffer(),
      Buffer.from([poolAuthorityBump]),
    ]);

    const keys = [
      // Required accounts for Continuum
      { pubkey: fifoState, isSigner: false, isWritable: true },
      { pubkey: this.cpSwapProgramId, isSigner: false, isWritable: false },

      // Remaining accounts for CP-Swap CPI - user must be first
      { pubkey: user, isSigner: true, isWritable: false },
      { pubkey: cpSwapAuthority, isSigner: false, isWritable: false },
      {
        pubkey: new PublicKey(poolConfig.ammConfig),
        isSigner: false,
        isWritable: false,
      },
      { pubkey: poolId, isSigner: false, isWritable: true },
      { pubkey: userSourceToken, isSigner: false, isWritable: true },
      { pubkey: userDestToken, isSigner: false, isWritable: true },
      {
        pubkey: new PublicKey(poolConfig.tokenAVault),
        isSigner: false,
        isWritable: true,
      },
      {
        pubkey: new PublicKey(poolConfig.tokenBVault),
        isSigner: false,
        isWritable: true,
      },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: tokenAMint, isSigner: false, isWritable: false },
      { pubkey: tokenBMint, isSigner: false, isWritable: false },
      {
        pubkey: new PublicKey(poolConfig.observationState),
        isSigner: false,
        isWritable: true,
      },
    ];

    this.logger.info("Building swap instruction keys", {
      user: user.toBase58(),
      poolId: poolId.toBase58(),
      userSourceToken: userSourceToken.toBase58(),
      userDestToken: userDestToken.toBase58(),
      fifoState: fifoState.toBase58(),
      cpSwapAuthority: cpSwapAuthority.toBase58(),
      ammConfig: poolConfig.ammConfig,
      tokenAVault: poolConfig.tokenAVault,
      tokenBVault: poolConfig.tokenBVault,
      observationState: poolConfig.observationState,
      signers: keys.filter((k) => k.isSigner).map((k) => k.pubkey.toBase58()),
      totalKeys: keys.length,
      programId: this.continuumProgramId.toBase58(),
    });

    return new TransactionInstruction({
      keys,
      programId: this.continuumProgramId,
      data,
    });
  }
}
