import { BN, Program, Provider } from "@coral-xyz/anchor";
import {
  Connection,
  Keypair,
  PublicKey,
  sendAndConfirmTransaction,
  Signer,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import {
  getAssociatedTokenAddress,
  getAssociatedTokenAddressSync,
  getMint,
} from "@solana/spl-token";
import type { ContinuumCpSwap } from "../target/types/continuum_cp_swap";
import idl from "../target/idl/continuum_cp_swap.json";
import {
  CP_POOL_AUTHORITY_SEED,
  CP_SWAP_PROGRAM,
  FIFO_STATE_SEED,
  ORDER_SEED,
} from "./constants";
import {
  ExecuteOrderAccounts,
  InitializeCpSwapPoolParams,
  SubmitOrderAccounts,
  SubmitOrderSimpleAccounts,
  SubmitOrderSimpleParams,
} from "./types";
export default class ContinuumCpSwapSDK {
  public program: Program<ContinuumCpSwap>;
  public connection: Connection;

  constructor(provider: Provider) {
    this.program = new Program<ContinuumCpSwap>(
      idl as ContinuumCpSwap,
      provider
    );
    this.connection = this.program.provider.connection;
  }

  public static getProgramId = (): PublicKey => {
    return new PublicKey(idl.address);
  };

  getFifoStatePDA = (): [PublicKey, number] => {
    return PublicKey.findProgramAddressSync(
      [FIFO_STATE_SEED],
      this.program.programId
    );
  };

  getPoolRegistryPDA = (poolId: PublicKey): [PublicKey, number] => {
    return PublicKey.findProgramAddressSync(
      [CP_POOL_AUTHORITY_SEED, poolId.toBuffer()],
      this.program.programId
    );
  };

  getOrderPDA = (user: PublicKey, sequence: BN): [PublicKey, number] => {
    return PublicKey.findProgramAddressSync(
      [ORDER_SEED, user.toBuffer(), sequence.toArrayLike(Buffer, "le", 8)],
      this.program.programId
    );
  };

  getPoolAuthorityPDA = (poolId: PublicKey): [PublicKey, number] => {
    return PublicKey.findProgramAddressSync(
      [CP_POOL_AUTHORITY_SEED, poolId.toBuffer()],
      this.program.programId
    );
  };

  parseFifoState = async (): Promise<{
    currentSequence: BN;
    admin: PublicKey;
    relayerPubkey: PublicKey;
    emergencyPause: boolean;
  }> => {
    return await this.program.account.fifoState.fetch(
      this.getFifoStatePDA()[0]
    );
  };

  /**
   * admin is signer
   * @param relayerPubkey
   * @returns
   */
  buildInitializeIx = async (
    relayerPubkey: PublicKey,
    admin: PublicKey
  ): Promise<TransactionInstruction> => {
    return await this.program.methods
      .initialize(relayerPubkey)
      .accounts({
        admin: admin,
      })
      .instruction();
  };

  buildInitializeCpSwapPoolIx = async (
    params: InitializeCpSwapPoolParams,
    cpInitAccounts: {
      pubkey: any;
      isSigner: boolean;
      isWritable: boolean;
    }[]
  ): Promise<TransactionInstruction> => {
    const {
      poolState,
      initAmount0,
      initAmount1,
      openTime,
      cpSwapProgram,
      admin,
    } = params;

    return await this.program.methods
      .initializeCpSwapPool(
        new BN(initAmount0),
        new BN(initAmount1),
        new BN(openTime)
      )
      .accountsPartial({
        poolState: poolState,
        cpSwapProgram,
        admin,
      })
      .remainingAccounts(cpInitAccounts)
      .instruction();
  };

  buildRegisterPoolIx = async (
    token1: PublicKey,
    token2: PublicKey,
    poolState: PublicKey,
    admin: PublicKey
  ): Promise<TransactionInstruction> => {
    return await this.program.methods
      .registerPool(token1, token2)
      .accountsPartial({
        poolState: poolState,
        admin: admin,
      })
      .instruction();
  };

  buildSubmitOrderSimpleIx = async (
    submitOrderSimpleParams: SubmitOrderSimpleParams,
    SubmitOrderSimpleAccounts: SubmitOrderSimpleAccounts
  ): Promise<TransactionInstruction> => {
    const { amountIn, minAmountOut, isBaseInput } = submitOrderSimpleParams;
    const { poolId, userDestinationToken, userSourceToken, user } =
      SubmitOrderSimpleAccounts;

    return await this.program.methods
      .submitOrderSimple(amountIn, minAmountOut, isBaseInput)
      .accounts({
        poolId,
        userDestinationToken,
        userSourceToken,
        user,
      })
      .instruction();
  };

  buildSubmitOrderIx = async (
    submitOrderSimpleParams: SubmitOrderSimpleParams,
    submitOrderAccounts: SubmitOrderAccounts
  ): Promise<TransactionInstruction> => {
    const { amountIn, minAmountOut, isBaseInput } = submitOrderSimpleParams;
    const { poolId, user, orderState } = submitOrderAccounts;

    return await this.program.methods
      .submitOrder(amountIn, minAmountOut, isBaseInput)
      .accountsPartial({
        orderState,
        poolId,
        user,
      })
      .instruction();
  };

  buildSwapImmediateIx = async (
    amountIn: BN,
    minAmountOut: BN,
    isBaseInput: boolean,
    poolId: PublicKey,
    cpSwapProgram: PublicKey,
    poolAuthorityBump: number,
    cpDepositAccounts: {
      pubkey: any;
      isSigner: boolean;
      isWritable: boolean;
    }[]
  ): Promise<TransactionInstruction> => {
    return await this.program.methods
      .swapImmediate(
        amountIn,
        minAmountOut,
        isBaseInput,
        poolId,
        poolAuthorityBump
      )
      .accounts({
        cpSwapProgram,
      })
      .remainingAccounts(cpDepositAccounts)
      .instruction();
  };

  buildWithdrawLpIx = async (
    lpAmount: BN,
    minAmount0: BN,
    minAmount1: BN,
    poolId: PublicKey,
    cpSwapProgram: PublicKey,
    poolAuthorityBump: number,
    cpDepositAccounts: {
      pubkey: any;
      isSigner: boolean;
      isWritable: boolean;
    }[]
  ): Promise<TransactionInstruction> => {
    return await this.program.methods
      .withdrawLp(lpAmount, minAmount0, minAmount1, poolId, poolAuthorityBump)
      .accounts({
        cpSwapProgram,
      })
      .remainingAccounts(cpDepositAccounts)
      .instruction();
  };

  buildExecuteOrderIx = async (
    expectedSequence: BN,
    executeOrderAccounts: ExecuteOrderAccounts
  ): Promise<TransactionInstruction> => {
    const {
      userDestination,
      userSource,
      executor,
      orderState,
      poolRegistry,
      poolAuthority,
      cpSwapProgram,
    } = executeOrderAccounts;

    return await this.program.methods
      .executeOrder(expectedSequence)
      .accountsPartial({
        cpSwapProgram,
        userDestination,
        userSource,
        executor,
        orderState,
        poolRegistry,
        poolAuthority,
      })
      .instruction();
  };

  buildDepositLpIx = async (
    minLpAmount: BN,
    maxAmount0: BN,
    maxAmount1: BN,
    poolId: PublicKey,
    cpSwapProgram: PublicKey,
    poolAuthorityBump: number,
    cpDepositAccounts: {
      pubkey: any;
      isSigner: boolean;
      isWritable: boolean;
    }[]
  ): Promise<TransactionInstruction> => {
    return await this.program.methods
      .depositLp(minLpAmount, maxAmount0, maxAmount1, poolId, poolAuthorityBump)
      .accounts({
        cpSwapProgram,
      })
      .remainingAccounts(cpDepositAccounts)
      .instruction();
  };

  buildCancelOrderIx = async (
    user: PublicKey
  ): Promise<TransactionInstruction> => {
    return await this.program.methods
      .cancelOrder()
      .accounts({
        user: user,
      })
      .instruction();
  };
}
