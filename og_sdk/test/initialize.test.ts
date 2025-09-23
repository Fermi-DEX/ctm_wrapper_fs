import {
  Connection,
  sendAndConfirmTransaction,
  Transaction,
} from "@solana/web3.js";
import { ContinuumCpSwapSDK } from "..";
import { CONNECTION, PAYER_1, RELAYER_KEY_1 } from ".";

const initialize = async () => {
  const sdk = new ContinuumCpSwapSDK({ connection: CONNECTION });

  console.log(ContinuumCpSwapSDK.getProgramId());
  

  const ix = await sdk.buildInitializeIx(RELAYER_KEY_1.publicKey , PAYER_1.publicKey);

  const transaction = new Transaction();

  transaction.add(ix);

  transaction.feePayer = PAYER_1.publicKey;
  transaction.recentBlockhash = (
    await CONNECTION.getLatestBlockhash()
  ).blockhash;

  const sig = await sendAndConfirmTransaction(CONNECTION, transaction, [
    PAYER_1,
  ]);

  console.log(sig);
};

initialize();
