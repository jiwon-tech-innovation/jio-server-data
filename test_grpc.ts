import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import path from 'path';

// Load Proto, relative to jiaa-server-data root when running via ts-node
const PROTO_PATH = path.join(__dirname, 'src/protos/intelligence.proto');
const packageDefinition = protoLoader.loadSync(PROTO_PATH, {
    keepCase: true,
    longs: String,
    enums: String,
    defaults: true,
    oneofs: true
});
const protoDescriptor = grpc.loadPackageDefinition(packageDefinition) as any;
const intelligenceService = protoDescriptor.jiaa.IntelligenceService;

// Config
const AI_GRPC_URL = 'api.jiobserver.cloud:443';
console.log(`📡 Connecting to AI Server at ${AI_GRPC_URL}...`);

const client = new intelligenceService(AI_GRPC_URL, grpc.credentials.createSsl());

// Test Request
const request = {
    client_id: 'test-script',
    url: 'https://www.youtube.com/watch?v=SpringTutorial',
    title: 'Spring Boot Tutorial - YouTube', // Should be [STUDY]
    page_content: ''
};

console.log(`📤 Sending Request: "${request.title}"`);

client.ClassifyURL(request, (err: any, response: any) => {
    if (err) {
        console.error('❌ gRPC Error:', err);
    } else {
        console.log('✅ AI Response:', JSON.stringify(response, null, 2));
    }
});
