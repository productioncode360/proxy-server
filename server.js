// ✅ IMPORT (require ki jagah)
import express from 'express';
import cors from 'cors';
import fetch from 'node-fetch';  // ✅ ab yeh kaam karega!
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import dotenv from 'dotenv';
import os from 'os';

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 5001;  // 5004 bhi kar sakte ho

// Security middleware
app.use(helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" }
}));

// Rate limiting - prevent abuse
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // limit each IP to 100 requests per windowMs
    message: 'Too many requests from this IP, please try again later.'
});

// Apply rate limiting to proxy route
app.use('/proxy', limiter);

// CORS configuration
app.use(cors({
    origin: [
        'http://localhost:5500',
        'http://localhost:3000',
        'http://127.0.0.1:5500',
        'https://dfsddf.vercel.app',
        /\.vercel\.app$/  // all vercel apps
    ],
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true
}));

// Body parser with limits
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Logging middleware
app.use((req, res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
    next();
});

// Health check endpoint
app.get('/', (req, res) => {
    res.json({
        status: '🟢 Proxy Server Running',
        message: 'CORS Proxy for API Testing',
        version: '1.0.0',
        endpoints: {
            proxy: '/proxy (POST)',
            health: '/health',
            info: '/info'
        }
    });
});

// Health check
app.get('/health', (req, res) => {
    res.status(200).json({ 
        status: 'healthy', 
        timestamp: new Date().toISOString(),
        uptime: process.uptime()
    });
});

// Server info
app.get('/info', (req, res) => {
    res.json({
        server: 'API Proxy',
        port: PORT,
        nodeVersion: process.version,
        platform: process.platform,
        memory: process.memoryUsage()
    });
});

// 🎯 MAIN PROXY ENDPOINT
app.post('/proxy', async (req, res) => {
    const startTime = Date.now();
    
    try {
        const { 
            url, 
            method = 'GET', 
            headers = {}, 
            body = null,
            timeout = 30000
        } = req.body;

        // Validation
        if (!url) {
            return res.status(400).json({
                error: 'URL is required',
                hint: 'Send { "url": "https://api.example.com/endpoint" }'
            });
        }

        // Validate URL format
        try {
            new URL(url);
        } catch (err) {
            return res.status(400).json({
                error: 'Invalid URL format',
                url: url,
                hint: 'URL must start with http:// or https://'
            });
        }

        console.log(`🔄 Proxying: ${method} ${url}`);

        // Prepare fetch options
        const fetchOptions = {
            method: method.toUpperCase(),
            headers: {
                'User-Agent': 'API-Tester-Proxy/1.0',
                ...headers
            },
            timeout: timeout
        };

        // Add body for non-GET requests
        if (body && method.toUpperCase() !== 'GET' && method.toUpperCase() !== 'HEAD') {
            fetchOptions.body = typeof body === 'string' 
                ? body 
                : JSON.stringify(body);
            
            // Auto-set content-type if not provided
            if (!fetchOptions.headers['Content-Type'] && typeof body !== 'string') {
                fetchOptions.headers['Content-Type'] = 'application/json';
            }
        }

        // Make the request
        const response = await fetch(url, fetchOptions);
        
        // Get response data
        const contentType = response.headers.get('content-type') || '';
        let data;
        
        if (contentType.includes('application/json')) {
            data = await response.json();
        } else {
            data = await response.text();
        }

        // Get response headers
        const responseHeaders = {};
        response.headers.forEach((value, key) => {
            responseHeaders[key] = value;
        });

        const endTime = Date.now();
        
        // Send response
        res.status(response.status).json({
            success: true,
            status: response.status,
            statusText: response.statusText,
            headers: responseHeaders,
            data: data,
            timing: {
                start: startTime,
                end: endTime,
                duration: `${endTime - startTime}ms`
            }
        });

        console.log(`✅ ${method} ${url} - ${response.status} (${endTime - startTime}ms)`);

    } catch (error) {
        const endTime = Date.now();
        
        console.error(`❌ Proxy Error:`, error.message);
        
        let statusCode = 500;
        let errorMessage = error.message;
        
        if (error.code === 'ENOTFOUND') {
            statusCode = 404;
            errorMessage = `Host not found: ${error.message}`;
        } else if (error.code === 'ECONNREFUSED') {
            statusCode = 502;
            errorMessage = `Connection refused: ${error.message}`;
        } else if (error.code === 'ETIMEDOUT') {
            statusCode = 504;
            errorMessage = `Request timeout: ${error.message}`;
        }

        res.status(statusCode).json({
            success: false,
            error: errorMessage,
            code: error.code || 'UNKNOWN',
            timing: {
                start: startTime,
                end: endTime,
                duration: `${endTime - startTime}ms`
            }
        });
    }
});

// Support GET requests to proxy
app.get('/proxy', async (req, res) => {
    const { url } = req.query;
    
    if (!url) {
        return res.status(400).json({
            error: 'URL query parameter required',
            example: '/proxy?url=https://api.example.com/data'
        });
    }
    
    // Reuse POST handler
    req.body = { url, method: 'GET' };
    app._router.handle(req, res);
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error('💥 Server Error:', err);
    res.status(500).json({
        error: 'Internal server error',
        message: err.message
    });
});

// Handle 404
app.use((req, res) => {
    res.status(404).json({
        error: 'Route not found',
        available: ['/', '/health', '/info', '/proxy (POST)']
    });
});

// Helper to get local IP
function getLocalIP() {
    const nets = os.networkInterfaces();
    
    for (const name of Object.keys(nets)) {
        for (const net of nets[name]) {
            if (net.family === 'IPv4' && !net.internal) {
                return net.address;
            }
        }
    }
    return '127.0.0.1';
}

// Start server
app.listen(PORT, () => {
    console.log('\n' + '='.repeat(50));
    console.log(`🚀 PROXY SERVER RUNNING`);
    console.log('='.repeat(50));
    console.log(`📍 Local: http://localhost:${PORT}`);
    console.log(`📍 Network: http://${getLocalIP()}:${PORT}`);
    console.log(`📝 Proxy endpoint: http://localhost:${PORT}/proxy`);
    console.log(`🔍 Health check: http://localhost:${PORT}/health`);
    console.log(`ℹ️  Server info: http://localhost:${PORT}/info`);
    console.log('='.repeat(50) + '\n');
});
