import path from 'path';
import express from 'express';
import bodyParser from 'body-parser';
import { BlacklistManager } from './core/blacklist-manager';
import { startGrpcServer } from './services/score-service';
import { startIngestion } from './services/ingestion-service';
import { startExpressServer } from './services/statistics-service';
import { connectKafka } from './config/kafka';
import { writeApi, Point } from './config/influx';

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

    // Health Check for ALB
    app.get('/health', (req, res) => res.status(200).send('OK'));

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
    });

    app.listen(port, () => {
        console.log(`[HTTP] Data Service listening at http://localhost:${port}`);
        console.log(`[Admin] Dashboard available at http://localhost:${port}/admin.html`);
    });

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
};

main().catch(console.error);
