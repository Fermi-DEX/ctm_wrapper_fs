#!/usr/bin/env node

const { Connection, clusterApiUrl } = require('@solana/web3.js');

async function analyzeTransaction(signature) {
  // Connect to devnet
  const connection = new Connection(clusterApiUrl('devnet'), 'confirmed');
  
  console.log(`🔍 Analyzing transaction: ${signature}`);
  console.log(`🌐 Network: Devnet`);
  console.log(`📡 RPC Endpoint: ${connection.rpcEndpoint}`);
  console.log('=' * 80);
  
  try {
    // Get transaction details
    console.log('📥 Fetching transaction details...');
    const txDetails = await connection.getTransaction(signature, {
      maxSupportedTransactionVersion: 0,
      commitment: 'confirmed'
    });
    
    if (!txDetails) {
      console.log('❌ Transaction not found!');
      console.log('Possible reasons:');
      console.log('  - Transaction doesn\'t exist');
      console.log('  - Transaction was pruned from the ledger');
      console.log('  - Incorrect signature');
      return;
    }
    
    console.log('✅ Transaction found!');
    console.log();
    
    // Basic transaction info
    console.log('📊 TRANSACTION OVERVIEW');
    console.log('-'.repeat(50));
    console.log(`Status: ${txDetails.meta?.err ? '❌ FAILED' : '✅ SUCCESS'}`);
    console.log(`Slot: ${txDetails.slot}`);
    console.log(`Block Time: ${txDetails.blockTime ? new Date(txDetails.blockTime * 1000).toISOString() : 'Unknown'}`);
    console.log(`Fee: ${txDetails.meta?.fee || 0} lamports`);
    console.log(`Compute Units Consumed: ${txDetails.meta?.computeUnitsConsumed || 'Unknown'}`);
    console.log();
    
    // Error details if failed
    if (txDetails.meta?.err) {
      console.log('🚨 ERROR DETAILS');
      console.log('-'.repeat(50));
      console.log('Error:', JSON.stringify(txDetails.meta.err, null, 2));
      console.log();
    }
    
    // Log messages
    if (txDetails.meta?.logMessages) {
      console.log('📜 TRANSACTION LOGS');
      console.log('-'.repeat(50));
      txDetails.meta.logMessages.forEach((log, index) => {
        console.log(`${index + 1}: ${log}`);
      });
      console.log();
    }
    
    // Instructions
    console.log('🔧 INSTRUCTIONS');
    console.log('-'.repeat(50));
    const message = txDetails.transaction.message;
    const accountKeys = message.staticAccountKeys || message.accountKeys;
    
    message.instructions.forEach((instruction, index) => {
      const programId = accountKeys[instruction.programIdIndex];
      console.log(`Instruction ${index + 1}:`);
      console.log(`  Program: ${programId.toBase58()}`);
      console.log(`  Accounts: ${instruction.accounts.length}`);
      console.log(`  Data: ${instruction.data.length} bytes`);
      
      // Try to identify known programs
      const programIdStr = programId.toBase58();
      if (programIdStr === 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA') {
        console.log(`  📝 Type: Token Program`);
      } else if (programIdStr === 'ComputeBudget111111111111111111111111111111') {
        console.log(`  📝 Type: Compute Budget Program`);
      } else if (programIdStr === '11111111111111111111111111111111') {
        console.log(`  📝 Type: System Program`);
      } else if (programIdStr === 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL') {
        console.log(`  📝 Type: Associated Token Account Program`);
      } else {
        console.log(`  📝 Type: Custom Program (Likely CP-Swap or Continuum)`);
      }
      console.log();
    });
    
    // Token balance changes
    if (txDetails.meta?.preTokenBalances && txDetails.meta?.postTokenBalances) {
      console.log('💰 TOKEN BALANCE CHANGES');
      console.log('-'.repeat(50));
      
      const preBalances = txDetails.meta.preTokenBalances;
      const postBalances = txDetails.meta.postTokenBalances;
      
      // Create a map for easier lookup
      const balanceChanges = new Map();
      
      preBalances.forEach(pre => {
        const key = `${pre.accountIndex}-${pre.mint}`;
        balanceChanges.set(key, { 
          accountIndex: pre.accountIndex,
          mint: pre.mint,
          owner: pre.owner,
          pre: pre.uiTokenAmount,
          post: null
        });
      });
      
      postBalances.forEach(post => {
        const key = `${post.accountIndex}-${post.mint}`;
        if (balanceChanges.has(key)) {
          balanceChanges.get(key).post = post.uiTokenAmount;
        } else {
          balanceChanges.set(key, {
            accountIndex: post.accountIndex,
            mint: post.mint,
            owner: post.owner,
            pre: { amount: '0', decimals: post.uiTokenAmount.decimals, uiAmount: 0 },
            post: post.uiTokenAmount
          });
        }
      });
      
      balanceChanges.forEach((change, key) => {
        const preAmount = change.pre?.uiAmount || 0;
        const postAmount = change.post?.uiAmount || 0;
        const diff = postAmount - preAmount;
        
        if (diff !== 0) {
          const account = accountKeys[change.accountIndex];
          console.log(`Account: ${account.toBase58()}`);
          console.log(`Mint: ${change.mint}`);
          console.log(`Owner: ${change.owner}`);
          console.log(`Before: ${preAmount}`);
          console.log(`After: ${postAmount}`);
          console.log(`Change: ${diff > 0 ? '+' : ''}${diff}`);
          console.log();
        }
      });
    }
    
    // SOL balance changes
    if (txDetails.meta?.preBalances && txDetails.meta?.postBalances) {
      console.log('💸 SOL BALANCE CHANGES');
      console.log('-'.repeat(50));
      
      txDetails.meta.preBalances.forEach((preBalance, index) => {
        const postBalance = txDetails.meta.postBalances[index];
        const diff = (postBalance - preBalance) / 1e9; // Convert to SOL
        
        if (diff !== 0) {
          const account = accountKeys[index];
          console.log(`Account: ${account.toBase58()}`);
          console.log(`Before: ${preBalance / 1e9} SOL`);
          console.log(`After: ${postBalance / 1e9} SOL`);
          console.log(`Change: ${diff > 0 ? '+' : ''}${diff} SOL`);
          console.log();
        }
      });
    }
    
    // Summary
    console.log('📋 SUMMARY');
    console.log('-'.repeat(50));
    console.log(`✅ Transaction ${txDetails.meta?.err ? 'FAILED' : 'SUCCEEDED'}`);
    console.log(`🔧 Instructions: ${message.instructions.length}`);
    console.log(`💰 Token accounts affected: ${txDetails.meta?.postTokenBalances?.length || 0}`);
    console.log(`💸 SOL accounts affected: ${txDetails.meta?.postBalances?.length || 0}`);
    
    if (!txDetails.meta?.err) {
      // Check if this looks like a successful swap
      const tokenChanges = (txDetails.meta?.preTokenBalances?.length || 0) + (txDetails.meta?.postTokenBalances?.length || 0);
      if (tokenChanges > 0) {
        console.log(`🎉 This appears to be a successful token transaction!`);
      }
    }
    
  } catch (error) {
    console.error('❌ Error fetching transaction:', error.message);
    console.log('\nTroubleshooting:');
    console.log('1. Check if the transaction signature is correct');
    console.log('2. Ensure you\'re using the correct network (devnet)');
    console.log('3. The transaction might be too old and pruned from the ledger');
  }
}

// Get signature from command line argument
const signature = process.argv[2] || '3krrodH55rMqfyESqFUMb3QibvcSRFfhENVwRNRuApX8rJnAFA1cvRpRAfuoXkYNq7xDEwbRusYGPQYEVRoceQ5j';

console.log('🔍 Solana Transaction Analyzer');
console.log('================================');
console.log();

analyzeTransaction(signature).catch(console.error);