# Docker Testing Setup for n8n Masumi Node

## Quick Docker Test (Recommended)

### 1. Create docker-compose.yml
```yaml
version: '3.8'
services:
  n8n:
    image: n8nio/n8n:latest
    ports:
      - "5678:5678"
    environment:
      - N8N_BASIC_AUTH_ACTIVE=false
      - N8N_DISABLE_PRODUCTION_MAIN_PROCESS=true
    volumes:
      - ./:/data/custom-nodes/masumi-paywall-n8n:ro
      - n8n_data:/home/node/.n8n
volumes:
  n8n_data:
```

### 2. Start n8n with your node
```bash
# Build your node first
npm run build

# Start n8n with Docker
docker-compose up -d

# Check logs
docker-compose logs -f n8n
```

### 3. Install your node in the running container
```bash
# Copy and install your package in the container
docker-compose exec n8n npm install -g /data/custom-nodes/masumi-paywall-n8n

# Restart n8n to load the node
docker-compose restart n8n
```

### 4. Access n8n
- Open http://localhost:5678
- Your Masumi Paywall node should be available in the node palette

## Alternative: Simple Docker Run

```bash
# Run n8n with volume mount
docker run -it --rm \
  --name n8n \
  -p 5678:5678 \
  -v $(pwd):/data/custom-nodes/masumi-paywall-n8n:ro \
  n8nio/n8n:latest

# In another terminal, install your node
docker exec n8n npm install -g /data/custom-nodes/masumi-paywall-n8n
```