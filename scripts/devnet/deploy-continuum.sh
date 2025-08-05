#!/bin/bash

# Deploy Continuum program to devnet

echo "🚀 Deploying Continuum program to devnet..."
echo ""
echo "Prerequisites:"
echo "- Anchor CLI 0.30.0 or compatible version"
echo "- Solana CLI configured for devnet"
echo "- Sufficient SOL in wallet for deployment"
echo ""

# Set network to devnet
solana config set --url https://api.devnet.solana.com

# Show current configuration
echo "Current Solana configuration:"
solana config get
echo ""

# Get wallet balance
echo "Wallet balance:"
solana balance
echo ""

# Build the program
echo "Building program..."
cd ../../programs/continuum-cp-swap
anchor build

if [ $? -ne 0 ]; then
    echo "❌ Build failed. Please ensure you have the correct toolchain installed."
    echo "Try running: rustup default solana"
    exit 1
fi

# Deploy the program
echo ""
echo "Deploying program..."
PROGRAM_ID="7uLunyG2Gr1uVNAS32qS4pKn7KkioTRvmKwpYgJeK65m"

# Deploy with the specific program ID
anchor deploy --program-id $PROGRAM_ID

if [ $? -eq 0 ]; then
    echo ""
    echo "✅ Program deployed successfully!"
    echo "Program ID: $PROGRAM_ID"
else
    echo ""
    echo "❌ Deployment failed"
    exit 1
fi

echo ""
echo "🎉 Done!"