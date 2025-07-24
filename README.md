# masumi-paywall-n8n

This is an n8n community node that provides Cardano blockchain paywall functionality for monetizing n8n workflows.

## Installation

To install this community node in n8n:

### Option 1: n8n Community Nodes (Recommended)
1. Go to Settings → Community Nodes in your n8n instance
2. Click "Install" and enter: `masumi-paywall-n8n`
3. Click "Install" and restart n8n

### Option 2: Manual Installation
```bash
# In your n8n installation directory
npm install masumi-paywall-n8n

# Restart n8n
```

## Prerequisites

1. **Masumi Payment Service**: You need a running Masumi payment service instance
2. **API Credentials**: Obtain API key and agent identifier from your Masumi service
3. **Cardano Wallet**: Set up seller verification key for receiving payments

## Configuration

### Credentials Setup

1. In n8n, go to Credentials → Add Credential
2. Select "Masumi Paywall API"
3. Configure the following:

| Field | Description | Example |
|-------|-------------|---------|
| Payment Service URL | Base URL of your Masumi service | `https://your-service.railway.app/api/v1` |
| API Key | Your Masumi service API key | `your-secret-api-key` |
| Agent Identifier | Your registered agent ID | `your-agent-id` |
| Seller Verification Key | Cardano wallet verification key | `your-seller-vkey` |
| Network | Cardano network to use | `Preprod` (testnet) or `Mainnet` |

### Node Parameters

| Parameter | Description | Default | Range |
|-----------|-------------|---------|--------|
| Timeout (minutes) | Maximum time to wait for payment | 10 | 1-60 |
| Poll Interval (seconds) | Time between payment status checks | 10 | 5-120 |

## Usage

1. **Add the Node**: Drag "Masumi Paywall" from the node palette to your workflow
2. **Configure Credentials**: Select or create Masumi Paywall API credentials
3. **Set Parameters**: Configure timeout and polling interval as needed
4. **Connect Input**: Connect a trigger or previous node that provides the request data
5. **Process Payment**: The node will handle the complete payment flow

### Input Format

The node expects input data in the following format:

```json
{
  "requestData": "data-to-be-processed"
}
```

If no `requestData` is provided, it defaults to "hello world" for hash generation.

### Output Format

On successful payment:

```json
{
  "success": true,
  "paymentStatus": "FundsLocked",
  "inputHash": "sha256-hash-of-input",
  "identifier": "14-char-hex-id",
  "paymentData": {
    "payByTime": "2025-01-XX...",
    "submitResultTime": "2025-01-XX...",
    "blockchainIdentifier": "...",
    "sellerVkey": "..."
  },
  "purchaseData": {
    "onChainState": "FundsLocked",
    "txHash": "...",
    "outputRef": "..."
  }
}
```

On payment failure or timeout:

```json
{
  "success": false,
  "error": "Payment timeout reached",
  "paymentStatus": "Pending"
}
```

## Payment Flow

1. **Hash Generation**: Creates SHA256 hash of input data
2. **Payment Request**: Submits payment request to Masumi service
3. **Fund Locking**: Creates purchase request to lock funds on Cardano blockchain
4. **Status Polling**: Monitors payment status until "FundsLocked" or timeout
5. **Result Return**: Returns success/failure with payment details

## Error Handling

The node handles common error scenarios:

- **API Failures**: Network issues, invalid credentials, service downtime
- **Payment Timeouts**: User doesn't complete payment within window
- **Blockchain Issues**: Transaction failures, network congestion
- **Configuration Errors**: Invalid URLs, missing credentials

Errors are returned in a structured format with descriptive messages.

## Development

### Local Development

```bash
# Clone and install dependencies
git clone <repository>
cd masumi-paywall-n8n
npm install

# Build TypeScript
npm run build

# Lint code
npm run lint

# Link for local testing
npm link
```

### Testing

Test the node with your Masumi service:

1. Ensure your Masumi service is running
2. Configure valid API credentials
3. Send test requests through the node
4. Verify payment processing and status polling

## Support

- **Issues**: Report bugs on GitHub Issues
- **Documentation**: Full docs available in repository
- **Community**: Join n8n Community for discussions

## License

MIT License - see LICENSE file for details.

## Contributing

Contributions welcome! Please read contributing guidelines and submit pull requests.

---

Built with ❤️ for the n8n community