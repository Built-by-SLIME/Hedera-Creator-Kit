#!/bin/bash

echo "🧪 Testing Art Generator API Server..."
echo ""

# Check if server is running
echo "1. Checking if server is running on port 3001..."
if curl -s http://localhost:3001/api/health > /dev/null 2>&1; then
    echo "✅ Server is running!"
    
    # Get health check response
    echo ""
    echo "2. Health check response:"
    curl -s http://localhost:3001/api/health | jq '.'
    
    echo ""
    echo "✅ API Server is ready!"
    echo ""
    echo "Available endpoints:"
    echo "  - POST http://localhost:3001/api/preview-collection"
    echo "  - POST http://localhost:3001/api/generate-collection"
    echo "  - GET  http://localhost:3001/api/health"
else
    echo "❌ Server is not running!"
    echo ""
    echo "To start the server, run:"
    echo "  cd backend"
    echo "  npm run dev"
    exit 1
fi

