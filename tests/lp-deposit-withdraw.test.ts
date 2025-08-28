import { PublicKey, Keypair } from '@solana/web3.js';
import BN from 'bn.js';
import { expect } from 'chai';
import {
  createDepositLiquidityInstruction,
  createWithdrawLiquidityInstruction,
} from '../sdk/src/instructions';

describe('LP deposit/withdraw instruction builders', () => {
  const dummy = Keypair.generate().publicKey;

  it('builds deposit liquidity wrapper instruction', () => {
    const ix = createDepositLiquidityInstruction({
      cpSwapProgram: dummy,
      poolId: dummy,
      minLpAmount: new BN(1),
      maxToken0Amount: new BN(2),
      maxToken1Amount: new BN(3),
      poolAuthorityBump: 255,
      owner: dummy,
      lpMint: dummy,
      userToken0: dummy,
      userToken1: dummy,
      userLp: dummy,
      token0Vault: dummy,
      token1Vault: dummy,
      tokenProgram: dummy,
    });
    expect(ix.data.slice(0,8)).to.deep.equal(Buffer.from([245,99,59,25,151,71,233,249]));
    expect(ix.keys.length).to.equal(11);
  });

  it('builds withdraw liquidity wrapper instruction', () => {
    const ix = createWithdrawLiquidityInstruction({
      cpSwapProgram: dummy,
      poolId: dummy,
      lpAmount: new BN(5),
      minToken0Amount: new BN(6),
      minToken1Amount: new BN(7),
      poolAuthorityBump: 1,
      owner: dummy,
      lpMint: dummy,
      userToken0: dummy,
      userToken1: dummy,
      userLp: dummy,
      token0Vault: dummy,
      token1Vault: dummy,
      tokenProgram: dummy,
    });
    expect(ix.data.slice(0,8)).to.deep.equal(Buffer.from([149,158,33,185,47,243,253,31]));
    expect(ix.keys.length).to.equal(11);
  });
});
