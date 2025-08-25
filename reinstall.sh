#!/bin/bash

# Masumi Paywall n8n Node Reinstall Script
# This script automates the full reinstall process for the n8n community node

set -e  # Exit on any error

echo "🔄 Starting Masumi Paywall n8n Node Reinstall..."

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Use current Node.js (22 LTS)
# No need to set NODE_PATH - using system default

echo -e "${BLUE}📦 Building package...${NC}"
npm run build
npm pack

# Get the package version and filename
PACKAGE_VERSION=$(node -p "require('./package.json').version")
PACKAGE_FILE="n8n-nodes-masumi-payment-${PACKAGE_VERSION}.tgz"

echo -e "${YELLOW}📋 Package: ${PACKAGE_FILE}${NC}"

echo -e "${RED}🗑️  Uninstalling old version...${NC}"
npm uninstall -g n8n-nodes-masumi-payment || echo "No previous version found"

echo -e "${GREEN}📥 Installing new version...${NC}"
npm install -g "./${PACKAGE_FILE}"

echo -e "${BLUE}🧹 Cleaning n8n cache...${NC}"
rm -rf ~/.n8n/nodes ~/.n8n/.cache ~/.n8n/cache

echo -e "${GREEN}📥 Installing in n8n nodes directory...${NC}"
# Find the latest package file (in case there are multiple versions)
LATEST_PACKAGE=$(ls -t n8n-nodes-masumi-payment-*.tgz 2>/dev/null | head -1)
if [ -n "$LATEST_PACKAGE" ]; then
    mkdir -p ~/.n8n/nodes
    cd ~/.n8n/nodes
    # Clean any existing installation
    rm -rf node_modules package-lock.json 2>/dev/null || true
    npm install "${OLDPWD}/${LATEST_PACKAGE}"
    cd - > /dev/null
    echo -e "${BLUE}💡 Installed ${LATEST_PACKAGE} locally for n8n${NC}"
else
    echo -e "${RED}❌ No package file found!${NC}"
    exit 1
fi

echo -e "${YELLOW}⏳ Killing existing n8n processes...${NC}"
pkill -f "n8n" || echo "No n8n processes running"

echo -e "${GREEN}🚀 Starting n8n in background...${NC}"
sleep 2
N8N_SECURE_COOKIE=false nohup n8n > n8n.log 2>&1 &
echo -e "${BLUE}📄 N8n logs: tail -f n8n.log${NC}"
sleep 3

echo ""
echo -e "${GREEN}✅ Reinstall complete!${NC}"
echo -e "${BLUE}📍 N8n will be available at: http://localhost:5678${NC}"
echo -e "${YELLOW}📦 Installed version: ${PACKAGE_VERSION}${NC}"
echo ""
echo -e "${BLUE}💡 All nodes now display version: v${PACKAGE_VERSION}${NC}"
echo -e "${YELLOW}🔧 To stop n8n: pkill -f 'n8n'${NC}"
echo -e "${GREEN}🎯 Setup: Node.js $(node --version) + n8n $(n8n --version)${NC}"