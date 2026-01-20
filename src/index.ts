import path from 'path';
import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import { BlacklistManager } from './core/blacklist-manager';
import { startGrpcServer } from './services/score-service';
import { startIngestion } from './services/ingestion-service';
import { startExpressServer } from './services/statistics-service';
import { connectKafka } from './config/kafka';

const main = async () => {
    console.log('Starting Data Service (Node.js)...');

    // 0. Initialize Blacklist Manager
    const blacklistManager = BlacklistManager.getInstance();

    // 1. HTTP Server (Express)
    const app = express();
    const port = 8083; // Data Service HTTP Port (8082 is taken by Auth Service)

    app.use(cors());
    app.use(bodyParser.json());
    // Serve "src/public" as static files (access via /admin.html)
    app.use(express.static(path.join(__dirname, 'public')));

    // API: Get Active Blacklist (Client)
    app.get('/api/v1/blacklist', (req, res) => {
        res.json({
            success: true,
            data: blacklistManager.getBlacklist()
        });
    });

    // API: Get Whitelist
    app.get('/api/v1/whitelist', (req, res) => {
        res.json({
            success: true,
            data: blacklistManager.getWhitelist()
        });
    });

    // API: Get ALL Items (Admin)
    app.get('/api/v1/blacklist/all', (req, res) => {
        res.json({
            success: true,
            data: blacklistManager.getAllItems()
        });
    });

    // API: Report App
    app.post('/api/v1/blacklist/report', (req, res) => {
        const { appName, isGame } = req.body;
        if (!appName) {
            res.status(400).json({ success: false, message: "Missing appName" });
            return;
        }
        const item = blacklistManager.reportApp(appName, isGame || true);
        res.json({ success: true, item });
    });

    // API: Review Item (Admin)
    app.post('/api/v1/blacklist/review', (req, res) => {
        const { appName, status } = req.body;
        const success = blacklistManager.reviewApp(appName, status);
        res.json({ success });
    });

    // API: Delete Item (Admin) [NEW]
    app.delete('/api/v1/blacklist/remove', (req, res) => {
        const { appName } = req.body;
        const success = blacklistManager.deleteApp(appName);
        res.json({ success });
    });

    // API: Add Blacklist (Admin - Manual)
    app.post('/api/v1/blacklist/add', (req, res) => {
        const { appName } = req.body;
        if (!appName) {
            res.status(400).json({ success: false, message: "Missing appName" });
            return;
        }
        // 1. Report as game (force creation)
        blacklistManager.reportApp(appName, true);
        // 2. Immediately approve
        const success = blacklistManager.reviewApp(appName, 'APPROVED');
        res.json({ success });
    });

    // API: Add Whitelist (Admin)
    app.post('/api/v1/whitelist/add', (req, res) => {
        const { appName } = req.body;
        if (!appName) {
            res.status(400).json({ success: false, message: "Missing appName" });
            return;
        }
        // Create if not exists
        blacklistManager.reportApp(appName, false);
        // Force status
        const success = blacklistManager.reviewApp(appName, 'WHITELISTED');
        res.json({ success });
    });

    // --- Monitor API (In-Memory) ---
    let latestClientApps: string[] = [];

    app.post('/api/v1/monitor/apps', (req, res) => {
        const { apps } = req.body;
        if (Array.isArray(apps)) {
            // Filter out empty strings or duplicates if needed
            latestClientApps = apps;
        }
        res.json({ success: true });
    });

    app.get('/api/v1/monitor/apps', (req, res) => {
        res.json({ success: true, data: latestClientApps });
    });

    app.listen(port, () => {
        console.log(`[HTTP] Data Service listening at http://localhost:${port}`);
        console.log(`[Admin] Dashboard available at http://localhost:${port}/admin.html`);
    });

    // ==========================================
    // 🔔 SSE (Server-Sent Events) for Real-Time Blacklist Push
    // ==========================================
    const sseClients = new Set<express.Response>();

    // SSE Endpoint - clients connect here for real-time updates
    app.get('/api/v1/blacklist/stream', (req, res) => {
        // SSE Headers
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.setHeader('Access-Control-Allow-Origin', '*');

        console.log('[SSE] Client connected');
        sseClients.add(res);

        // Send current blacklist immediately on connection
        const initialData = JSON.stringify({
            type: 'BLACKLIST_SYNC',
            data: blacklistManager.getBlacklist(),
            timestamp: Date.now()
        });
        res.write(`data: ${initialData}\n\n`);

        // Heartbeat to keep connection alive
        const heartbeat = setInterval(() => {
            res.write(`: heartbeat\n\n`);
        }, 30000);

        // Cleanup on disconnect
        req.on('close', () => {
            console.log('[SSE] Client disconnected');
            clearInterval(heartbeat);
            sseClients.delete(res);
        });
    });

    // Broadcast blacklist updates to all SSE clients
    const broadcastBlacklistUpdate = () => {
        const payload = JSON.stringify({
            type: 'BLACKLIST_UPDATE',
            data: blacklistManager.getBlacklist(),
            timestamp: Date.now()  // For latency measurement
        });

        sseClients.forEach((client) => {
            client.write(`data: ${payload}\n\n`);
        });

        console.log(`[SSE] Broadcasted blacklist update to ${sseClients.size} clients`);
    };

    // Subscribe to BlacklistManager 'change' event
    blacklistManager.on('change', () => {
        broadcastBlacklistUpdate();
    });

    console.log(`[SSE] Stream endpoint available at http://localhost:${port}/api/v1/blacklist/stream`);

    // 2. Connect Kafka
    await connectKafka();

    // 3. Start Ingestion Loop
    await startIngestion();

    // 4. Start gRPC Server (for score streaming)
    startGrpcServer();

    // 5. Start Express Server (for Statistics REST API)
    const statsPort = parseInt(process.env.STATS_PORT || '3001');
    startExpressServer(statsPort);
};

main().catch(console.error);
