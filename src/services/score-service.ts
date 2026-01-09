import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import path from 'path';
import { eventBus, EVENTS } from '../core/event-bus';

// Corrected path: common/proto/score.proto
// Corrected path: point to local 'protos' directory copied into container
const PROTO_PATH = path.resolve(__dirname, '../../protos/score.proto');

const packageDefinition = protoLoader.loadSync(PROTO_PATH, {
    keepCase: true,
    longs: String,
    enums: String,
    defaults: true,
    oneofs: true,
    includeDirs: [path.resolve(__dirname, '../../protos')]
});

const protoDescriptor = grpc.loadPackageDefinition(packageDefinition) as any;
const scoreProto = protoDescriptor.jiaa.score;

const subscribeScore = (call: any) => {
    console.log('Client subscribed to Score updates');

    const onUpdate = (update: any) => {
        call.write(update);
    };

    eventBus.on(EVENTS.SCORE_UPDATED, onUpdate);

    call.on('cancelled', () => {
        console.log('Client disconnected');
        eventBus.off(EVENTS.SCORE_UPDATED, onUpdate);
    });

    call.on('end', () => {
        eventBus.off(EVENTS.SCORE_UPDATED, onUpdate);
    });
};

export const startGrpcServer = () => {
    const server = new grpc.Server();
    server.addService(scoreProto.ScoreService.service, {
        SubscribeScore: subscribeScore
    });

    const PORT = process.env.GRPC_PORT || '0.0.0.0:9090';
    server.bindAsync(PORT, grpc.ServerCredentials.createInsecure(), (err, port) => {
        if (err) {
            console.error(err);
            return;
        }
        console.log(`gRPC Server running on port ${port}`);
    });
};
