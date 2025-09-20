import {
  Commitment,
  Connection,
  ConnectionConfig,
  Keypair,
  PublicKey,
  Signer,
  Transaction,
} from '@solana/web3.js';
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  getAssociatedTokenAddress,
} from '@solana/spl-token';
import fs from 'fs';
import path from 'path';
import { ProxyAgent, setGlobalDispatcher } from 'undici';

export const proxyUrl = process.env.HTTPS_PROXY ?? process.env.HTTP_PROXY;
const undiciProxyAgent = proxyUrl ? new ProxyAgent(proxyUrl) : undefined;

if (undiciProxyAgent) {
  setGlobalDispatcher(undiciProxyAgent);
}

const commitmentRank: Record<'processed' | 'confirmed' | 'finalized', number> = {
  processed: 0,
  confirmed: 1,
  finalized: 2,
};

const commitmentAliases: Record<string, 'processed' | 'confirmed' | 'finalized'> = {
  processed: 'processed',
  recent: 'processed',
  single: 'processed',
  confirmed: 'confirmed',
  singleGossip: 'confirmed',
  finalized: 'finalized',
  max: 'finalized',
  root: 'finalized',
};

function normalizeCommitment(commitment: Commitment = 'confirmed'): 'processed' | 'confirmed' | 'finalized' {
  return commitmentAliases[commitment] ?? 'confirmed';
}

export function createHttpConnection(endpoint: string, commitment: Commitment = 'confirmed'): Connection {
  const config: ConnectionConfig = { commitment };
  if (proxyUrl) {
    config.httpAgent = false;
    config.fetch = (input: any, init?: any) => (globalThis as any).fetch(input, init);
  }
  return new Connection(endpoint, config);
}

export function loadOrGenerateKeypair(keypairPath: string): Keypair {
  const resolved = path.resolve(keypairPath);
  if (fs.existsSync(resolved)) {
    const secret = JSON.parse(fs.readFileSync(resolved, 'utf8')) as number[];
    return Keypair.fromSecretKey(Uint8Array.from(secret));
  }

  const keypair = Keypair.generate();
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  fs.writeFileSync(resolved, JSON.stringify(Array.from(keypair.secretKey)));
  console.log(`🆕 Generated new keypair at ${resolved}`);
  return keypair;
}

export const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export async function confirmSignature(
  connection: Connection,
  signature: string,
  commitment: Commitment = 'confirmed',
  lastValidBlockHeight?: number,
  timeoutMs = 60_000,
): Promise<void> {
  const desiredLevel = normalizeCommitment(commitment);
  const start = Date.now();

  while (true) {
    const statusResp = await connection.getSignatureStatuses([signature]);
    const status = statusResp.value[0];

    if (status) {
      if (status.err) {
        throw new Error(`Transaction ${signature} failed: ${JSON.stringify(status.err)}`);
      }

      const currentLevel = status.confirmationStatus
        ? normalizeCommitment(status.confirmationStatus)
        : status.confirmations === null
          ? 'finalized'
          : status.confirmations !== undefined
            ? status.confirmations > 0
              ? 'confirmed'
              : 'processed'
            : undefined;

      if (currentLevel && commitmentRank[currentLevel] >= commitmentRank[desiredLevel]) {
        return;
      }
    }

    if (lastValidBlockHeight !== undefined) {
      const blockHeight = await connection.getBlockHeight(commitment);
      if (blockHeight > lastValidBlockHeight) {
        throw new Error(`Transaction ${signature} expired: block height ${blockHeight} > ${lastValidBlockHeight}`);
      }
    }

    if (Date.now() - start > timeoutMs) {
      throw new Error(`Timed out waiting for confirmation of ${signature}`);
    }

    await sleep(2_000);
  }
}

export async function sendTransactionWithRetry(
  connection: Connection,
  transaction: Transaction,
  signers: Signer[],
  commitment: Commitment = 'confirmed',
): Promise<string> {
  if (!signers.length) {
    throw new Error('At least one signer is required to send a transaction.');
  }

  const latestBlockhash = await connection.getLatestBlockhash(commitment);
  transaction.recentBlockhash = latestBlockhash.blockhash;
  if (!transaction.feePayer) {
    transaction.feePayer = signers[0].publicKey;
  }

  const uniqueSigners = new Map<string, Signer>();
  for (const signer of signers) {
    uniqueSigners.set(signer.publicKey.toBase58(), signer);
  }
  transaction.sign(...uniqueSigners.values());

  const raw = transaction.serialize();
  const signature = await connection.sendRawTransaction(raw);
  await confirmSignature(
    connection,
    signature,
    commitment,
    latestBlockhash.lastValidBlockHeight,
  );
  return signature;
}

export async function ensureAta(
  connection: Connection,
  payer: Keypair,
  owner: PublicKey,
  mint: PublicKey,
): Promise<PublicKey> {
  const ata = await getAssociatedTokenAddress(mint, owner, true);
  const info = await connection.getAccountInfo(ata, 'confirmed');
  if (!info) {
    console.log(
      `   → Creating ATA for ${owner.toBase58()} and mint ${mint.toBase58()}`,
    );
    const ix = createAssociatedTokenAccountIdempotentInstruction(
      payer.publicKey,
      ata,
      owner,
      mint,
      TOKEN_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID,
    );
    const tx = new Transaction().add(ix);
    const sig = await sendTransactionWithRetry(connection, tx, [payer]);
    console.log(`   → Created ATA ${ata.toBase58()} (${sig})`);
  }
  return ata;
}
