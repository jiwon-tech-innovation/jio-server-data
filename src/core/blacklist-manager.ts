import fs from 'fs';
import path from 'path';

export interface BlacklistItem {
    appName: string;
    isGame: boolean;
    status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'WHITELISTED';
    reportCount: number;
    lastReportedAt: number;
}

export class BlacklistManager {
<<<<<<< HEAD
    private filePath: string;
    private blacklist: Map<string, BlacklistItem>;

    constructor() {
=======
    private static instance: BlacklistManager;
    private filePath: string;
    private blacklist: Map<string, BlacklistItem>;

    private constructor() {
>>>>>>> origin/mvp/v5.0.0
        // Data stored in 'jiaa-server-data/data/blacklist.json'
        this.filePath = path.join(process.cwd(), 'data', 'blacklist.json');
        this.blacklist = new Map();
        this.load();
    }

<<<<<<< HEAD
=======
    public static getInstance(): BlacklistManager {
        if (!BlacklistManager.instance) {
            BlacklistManager.instance = new BlacklistManager();
        }
        return BlacklistManager.instance;
    }

>>>>>>> origin/mvp/v5.0.0
    private load() {
        try {
            if (fs.existsSync(this.filePath)) {
                const data = fs.readFileSync(this.filePath, 'utf-8');
                const items: BlacklistItem[] = JSON.parse(data);
                items.forEach(item => this.blacklist.set(item.appName, item));
                console.log(`[Blacklist] Loaded ${items.length} items.`);
            } else {
                // Initialize default logic or empty
                console.log("[Blacklist] No existing file, starting empty.");
                this.save();
            }
        } catch (error) {
            console.error("[Blacklist] Failed to load:", error);
        }
    }

    private save() {
        try {
            const items = Array.from(this.blacklist.values());
            fs.writeFileSync(this.filePath, JSON.stringify(items, null, 2), 'utf-8');
        } catch (error) {
            console.error("[Blacklist] Failed to save:", error);
        }
    }

    public getAllItems(): BlacklistItem[] {
        return Array.from(this.blacklist.values());
    }

    public getBlacklist(): BlacklistItem[] {
        // Return only APPROVED games or heavily reported ones for client blocking
        return Array.from(this.blacklist.values()).filter(item =>
            item.status === 'APPROVED' ||
            (item.status === 'PENDING' && item.reportCount >= 3) // Temporary auto-block threshold
        );
    }

    public getWhitelist(): BlacklistItem[] {
        return Array.from(this.blacklist.values()).filter(item => item.status === 'WHITELISTED');
    }

    public reportApp(appName: string, isGame: boolean) {
        let item = this.blacklist.get(appName);

        if (item) {
            // Existing item
            item.reportCount += 1;
            item.lastReportedAt = Date.now();
            console.log(`[Blacklist] Updated report for '${appName}': count=${item.reportCount}`);
        } else {
            // New item
            item = {
                appName: appName,
                isGame: isGame,
                status: 'PENDING',
                reportCount: 1,
                lastReportedAt: Date.now()
            };
            this.blacklist.set(appName, item);
            console.log(`[Blacklist] New report for '${appName}'`);
        }

        this.save();
        return item;
    }

    public reviewApp(appName: string, status: 'APPROVED' | 'REJECTED' | 'WHITELISTED') {
        const item = this.blacklist.get(appName);
        if (item) {
            item.status = status;
            this.save();
            return true;
        }
        return false;
    }
<<<<<<< HEAD
=======

    public deleteApp(appName: string): boolean {
        if (this.blacklist.has(appName)) {
            this.blacklist.delete(appName);
            this.save();
            console.log(`[Blacklist] Deleted '${appName}'`);
            return true;
        }
        return false;
    }
>>>>>>> origin/mvp/v5.0.0
}
