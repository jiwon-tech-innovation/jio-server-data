import path from 'path';
import express from 'express';
<<<<<<< HEAD
=======
import cors from 'cors';
>>>>>>> origin/mvp/v5.0.0
import bodyParser from 'body-parser';
import { BlacklistManager } from './core/blacklist-manager';
import { startGrpcServer } from './services/score-service';
import { startIngestion } from './services/ingestion-service';
import { startExpressServer } from './services/statistics-service';
import { connectKafka } from './config/kafka';
<<<<<<< HEAD
import { writeApi, Point } from './config/influx';
=======
>>>>>>> origin/mvp/v5.0.0

const main = async () => {
    console.log('Starting Data Service (Node.js)...');

    // 0. Initialize Blacklist Manager
<<<<<<< HEAD
    const blacklistManager = new BlacklistManager();

    // 1. HTTP Server (Express)
    const app = express();
    const port = 8082; // Data Service HTTP Port

=======
    const blacklistManager = BlacklistManager.getInstance();

    // 1. HTTP Server (Express)
    const app = express();
    const port = 8083; // Data Service HTTP Port (8082 is taken by Auth Service)

    app.use(cors());
>>>>>>> origin/mvp/v5.0.0
    app.use(bodyParser.json());
    // Serve "src/public" as static files (access via /admin.html)
    app.use(express.static(path.join(__dirname, 'public')));

<<<<<<< HEAD
    // Health Check for ALB
    app.get('/health', (req, res) => res.status(200).send('OK'));

=======
>>>>>>> origin/mvp/v5.0.0
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

<<<<<<< HEAD
=======
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

>>>>>>> origin/mvp/v5.0.0
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

<<<<<<< HEAD
    // API: Generic Log Ingestion (Data Trinity)
    // Writes to InfluxDB 'user_activity' measurement
    app.post('/api/v1/log', async (req, res) => {
        try {
            const { user_id, category, type, data, timestamp } = req.body;

            if (!user_id || !category || !data) {
                res.status(400).json({ success: false, message: "Missing required fields" });
                return;
            }

            console.log(`[Log] Received ${category}/${type} log for ${user_id}`);

            const point = new Point('user_activity')
                .tag('user_id', user_id)
                .tag('category', category)
                .tag('type', type || 'general')
                .timestamp(new Date(timestamp || Date.now()));

            // Handle Data Fields
            if (data.score !== undefined) point.floatField('score', parseFloat(data.score));
            if (data.wrong_count !== undefined) point.intField('wrong_count', parseInt(data.wrong_count));
            if (data.action_detail) point.stringField('action_detail', data.action_detail);

            // Allow generic fields
            if (data.duration_min !== undefined) point.floatField('duration_min', parseFloat(data.duration_min));

            // Store complex objects as JSON string (e.g., wrong_answers)
            if (data.wrong_answers) {
                point.stringField('wrong_answers', JSON.stringify(data.wrong_answers));
            }

            writeApi.writePoint(point);
            await writeApi.flush(); // Ensure immediate write for tests

            res.json({ success: true, message: "Log saved to InfluxDB" });

        } catch (e: any) {
            console.error("[API] Log Ingestion Error:", e);
            res.status(500).json({ success: false, message: e.message });
        }
=======
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
>>>>>>> origin/mvp/v5.0.0
    });

    app.listen(port, () => {
        console.log(`[HTTP] Data Service listening at http://localhost:${port}`);
        console.log(`[Admin] Dashboard available at http://localhost:${port}/admin.html`);
    });

<<<<<<< HEAD
    // 2. Connect Kafka (non-blocking - continue even if Kafka fails)
    try {
        await connectKafka();
    } catch (err) {
        console.warn('[Main] Kafka connection failed, continuing without Kafka:', err);
    }

    // 3. Start Ingestion Loop (non-blocking - continue even if ingestion fails)
    try {
        await startIngestion();
    } catch (err) {
        console.warn('[Main] Ingestion service failed, continuing without ingestion:', err);
    }

    // 4. Start gRPC Server (for score streaming)
    try {
        startGrpcServer();
    } catch (err) {
        console.warn('[Main] gRPC server failed, continuing without gRPC:', err);
    }

    // 5. Start Express Server (for Statistics REST API) - Critical, must not fail
    try {
        const statsPort = parseInt(process.env.STATS_PORT || '3001');
        startExpressServer(statsPort);
    } catch (err) {
        console.error('[Main] CRITICAL: Statistics server failed to start:', err);
        throw err; // Re-throw to ensure process exits if stats server fails
    }
=======
    // 2. Connect Kafka
    await connectKafka();

    // 3. Start Ingestion Loop
    await startIngestion();

    // 4. Start gRPC Server (for score streaming)
    startGrpcServer();

    // 5. Start Express Server (for Statistics REST API)
    const statsPort = parseInt(process.env.STATS_PORT || '3001');
    startExpressServer(statsPort);
>>>>>>> origin/mvp/v5.0.0
};

main().catch(console.error);
