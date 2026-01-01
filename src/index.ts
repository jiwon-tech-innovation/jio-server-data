import { startGrpcServer } from './services/score-service';
import { startIngestion } from './services/ingestion-service';
import { connectKafka } from './config/kafka';

const main = async () => {
    console.log('Starting Data Service (Node.js)...');

    // 1. Connect Kafka
    await connectKafka();

    // 2. Start Ingestion Loop
    await startIngestion();

    // 3. Start gRPC Server
    startGrpcServer();
};

main().catch(console.error);
