import { PublicKey } from "@solana/web3.js";
import { BN } from "@coral-xyz/anchor";

export interface InitializeCpSwapPoolParams {
  poolState: PublicKey;
  initAmount0: BN;
  initAmount1: BN;
  openTime: BN;
  cpSwapProgram: PublicKey;
  admin: PublicKey;
}

export interface SubmitOrderSimpleParams {
  amountIn: BN;
  minAmountOut: BN;
  isBaseInput: boolean;
}

export interface SubmitOrderSimpleAccounts {
  poolId: PublicKey;
  userDestinationToken: PublicKey;
  userSourceToken: PublicKey;
  user: PublicKey;
}

export interface ExecuteOrderAccounts {
  orderState: PublicKey;
  cpSwapProgram: PublicKey;
  poolRegistry: PublicKey;
  poolAuthority: PublicKey;
  userDestination: PublicKey;
  userSource: PublicKey;
  executor: PublicKey;
}

export interface SubmitOrderAccounts {
  orderState: PublicKey;
  poolId: PublicKey;
  user: PublicKey;
}
