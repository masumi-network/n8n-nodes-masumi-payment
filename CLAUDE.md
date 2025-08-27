# Masumi Paywall n8n Community Node - Development Guide

- **Package**: `n8n-nodes-masumi-payment`, published to npm
- **Architecture**: 3-node system (Trigger → Respond → Paywall) with fire-and-forget webhook triggering
- **MIP-003 Compliance**: Full support for Masumi payment protocol is must have, see https://github.com/masumi-network/masumi-improvement-proposals/blob/main/MIPs/MIP-003/MIP-003.md
- **Key Features**: Separate triggers for each endpoint, split workflow architecture, immediate job accessibility, background payment polling

## Architecture Overview

### 3-Node System
1. **MasumiPaywallTrigger** - Webhook receiver for all endpoints (`/start_job`, `/status`, `/availability`, `/input_schema`, `/start_polling`)
2. **MasumiPaywallRespond** - Handles responses and job creation with fire-and-forget internal webhook triggering  
3. **MasumiPaywall** - Payment polling and workflow execution

### Key Technical Concepts

**Payment States (OnChain):**
- `FundsLocked` → SUCCESS: Payment confirmed, workflow continues
- `null` → PENDING: Still polling for payment
- Error states → `FundsOrDatumInvalid`, `RefundRequested`, `Disputed`, `RefundWithdrawn`, `DisputedWithdrawn`

**Job Storage:**
Jobs stored in n8n static data (`this.getWorkflowStaticData('global')`) with complete lifecycle tracking from `pending` → `awaiting_payment` → `running` → `completed`

**Fire-and-forget Webhook:**
- `/start_job` returns immediately
- Internal webhook triggers `/start_polling` in background

## Installation & Testing Workflow Locally

### 🚀 Quick Reinstall (Recommended)
For localhost n8n installation, use the automated reinstall script for one-command updates:

```bash
./reinstall.sh
```

**What the script does:**
- Builds and packages the node
- Uninstalls old version globally
- Installs new version globally
- **Installs locally in n8n nodes directory** (critical for n8n detection)
- Clears n8n cache
- Kills existing n8n processes
- Starts fresh n8n instance with proper environment variables
- Creates n8n.log for monitoring

### Current Environment Setup (Updated August 2025)
- **Node.js**: v22.18.0 (LTS)
- **N8n**: v1.107.4 (Latest version August 2025)
- **Package**: n8n-nodes-masumi-payment with version display
- **Architecture**: All nodes show version (e.g., "Masumi Paywall v0.5.12")

### Manual Installation Process
If you need to install manually:

1. **Build and pack the package:**
   ```bash
   npm run build && npm pack
   ```

2. **Install globally (Node 22 LTS):**
   ```bash
   # Uninstall old version first
   npm uninstall -g n8n-nodes-masumi-payment
   
   # Install new version
   npm install -g ./n8n-nodes-masumi-payment-X.X.X.tgz
   ```

3. **Install locally in n8n and restart:**
   ```bash
   # Kill any running n8n processes
   pkill -f "n8n" || true
   
   # Clear all n8n caches
   rm -rf ~/.n8n/nodes ~/.n8n/.cache
   
   # Install locally in n8n (CRITICAL STEP)
   cd ~/.n8n/nodes
   npm install /path/to/your/n8n-nodes-masumi-payment-X.X.X.tgz
   cd -
   
   # Start n8n with proper environment variables, false secure cookie is required for safari compatibility 
   N8N_SECURE_COOKIE=false n8n
   ```

4. **Verify installation:**
   - Go to http://localhost:5678 and refresh (check if you have playwright MCP)
   - Click on plus, enter "masumi" in search field, check nodes show correct version numbers

### Environment Commands
- **Check versions**: `node --version && n8n --version`
- **List packages**: `npm list -g | grep -E "(n8n|masumi)"`
- **Stop n8n**: `pkill -f 'n8n'`
- **Start n8n in Safari compatibility mode**: `N8N_SECURE_COOKIE=false n8n`
- **View logs**: `tail -f n8n.log`

## ⚠️ CRITICAL WARNINGS ⚠️

> **AVOID using emojis, unless you absolutely must. Emojis must be sparse to grab attention, don't spam them everywhere.**
> **AVOID unnecessary comments.**

**NEVER RUN `rm -rf ~/.n8n/` - THIS DELETES ALL WORKFLOWS AND DATA!**

**Safe cache clearing:**
- ✅ SAFE: `rm -rf ~/.n8n/nodes ~/.n8n/.cache` (cache only)
- ❌ DANGEROUS: `rm -rf ~/.n8n/` (DELETES EVERYTHING!)

## Development Patterns & Code Architecture

### **Modular Function Design**
> **Keep the files short! Check if the file grows too long - proactively propose splitting it, extracting functions to handlers, etc. ASK for user confirmation before refactoring!  


Some functions are already extracted into separate files for testability and reusability:

```
nodes/MasumiPaywall/
├── create-payment.ts        # Pure functions: generateInputHash(), createPayment()
├── create-purchase.ts       # Purchase logic with mock support
├── check-payment-status.ts  # Polling logic with timeout handling
├── job-handler.ts          # Storage operations: storeJob(), getJob()
└── *.test.ts              # Comprehensive unit tests for each module
```

### **Testing Strategy**
- **Unit Tests**: Each function has isolated tests (e.g., `create-payment.test.ts`)
- **Integration Tests**: End-to-end pipeline testing (`start-job-pipeline.test.ts`)
- **Mock Strategy**: HTTP calls mocked with `global.fetch = jest.fn()`
- **Test Coverage**: All critical paths including error handling
- **CI/CD**: Tests run on `prepublishOnly` to ensure quality before npm publish

### **Node Implementation Pattern**
n8n nodes are thin wrappers that orchestrate pure functions:

```typescript
// Node.ts: Thin orchestration layer
async execute(): Promise<INodeExecutionData[][]> {
    const credentials = await this.getCredentials('masumiPaywallApi');
    const storage: JobStorage = this.getWorkflowStaticData('global');
    
    // Call pure function with extracted dependencies
    const result = await handleStartJob({
        credentials,
        storage,
        inputData,
        identifierFromPurchaser,
        triggerContext
    });
    
    return [returnData];
}

// handlers/start-job.ts: Pure business logic
export async function handleStartJob(options: StartJobHandlerOptions) {
    // Testable function with clear input/output
    // No n8n dependencies - easy to unit test
}
```

### **Handler Extraction Pattern**
Complex operations extracted to `/handlers/` directory:
- `start-job.ts` - Payment creation and job storage
- `status.ts` - Job status lookup and response formatting  
- `availability.ts` - Health check responses
- `webhook-trigger.ts` - Internal webhook utilities

### **Error Handling & Logging**
- **Structured Errors**: Clear error messages with context
- **Debug Logging**: Extensive console.log for troubleshooting
- **Error Propagation**: Proper error types for n8n workflow control
- **Timeout Handling**: Graceful handling of API timeouts

### **Async Patterns**
- **Fire-and-forget**: Internal webhooks trigger without blocking responses
- **Promise Management**: Proper async/await with error catching
- **Timeout Controls**: Configurable polling intervals and timeouts

### **TypeScript Interfaces**
Strong typing with clear contracts:
```typescript
export interface StartJobHandlerOptions {
    credentials: IDataObject;
    storage: JobStorage;
    inputData: any;
    identifierFromPurchaser: string;
    triggerContext: any;
}

export interface StartJobResult {
    responseData: any;
    success: boolean;
    error?: string;
}
```

### **Quality Assurance**
- **Linting**: ESLint with n8n-specific rules
- **Formatting**: Prettier for consistent code style
- **Type Checking**: Strict TypeScript compilation
- **Pre-publish Checks**: Build + lint + format + test pipeline

### **Development Workflow**
```bash
# Local development cycle
npm run build    # TypeScript compilation
npm run lint     # Code quality checks  
npm run test     # Unit and integration tests
./reinstall.sh   # Local n8n testing

# Publishing workflow (automated)
npm publish      # Runs prepublishOnly hook → build + lint + format + test
```

This architecture ensures **maintainable, testable, and reliable** n8n community nodes following software engineering best practices.

## n8n Community Compliance (v0.6.0+)

### **Required Files**
- `LICENSE.md` - MIT license with proper copyright
- `.eslintrc.prepublish.js` - Prepublish lint configuration
- `index.js` - Empty root file (required by n8n template)

### **Package.json Requirements**
- Node engine: `>=20.15` (matches n8n template)
- Main entry: `"index.js"` (not dist/index.js)
- No runtime dependencies (move to devDependencies)
- Build script: `"npx rimraf dist && tsc && gulp build:icons"`
- PrepublishOnly: `"npm run build && npm run lint -c .eslintrc.prepublish.js nodes credentials package.json"`

### **ESLint Configuration**
- Use full n8n template `.eslintrc.js` with comprehensive rules
- All node options must be alphabetized by 'name'
- Display names must be in title case
- Test files excluded from project linting

### **Submission Checklist**
- ✅ All tests pass (`npm test`)
- ✅ Build succeeds (`npm run build`)
- ✅ Lint passes (`npm run lint`)
- ✅ Package creates successfully (`npm pack`)
- ✅ No .tgz files in repository
- ✅ Version bumped appropriately