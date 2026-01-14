import path from 'path';
import express from 'express';
import bodyParser from 'body-parser';
import { BlacklistManager } from './core/blacklist-manager';
import { startGrpcServer } from './services/score-service';
import { startIngestion } from './services/ingestion-service';
import { startExpressServer } from './services/statistics-service';
import { connectKafka } from './config/kafka';

const main = async () => {
    console.log('Starting Data Service (Node.js)...');

    // 0. Initialize Blacklist Manager
    const blacklistManager = new BlacklistManager();

    // 1. HTTP Server (Express)
    const app = express();
    const port = 8082; // Data Service HTTP Port

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

    app.listen(port, () => {
        console.log(`[HTTP] Data Service listening at http://localhost:${port}`);
        console.log(`[Admin] Dashboard available at http://localhost:${port}/admin.html`);
    });

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
