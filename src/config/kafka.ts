import { Kafka, logLevel } from 'kafkajs';
import dotenv from 'dotenv';

dotenv.config();

const kafka = new Kafka({
  clientId: 'jiaa-data-service',
  brokers: [(process.env.KAFKA_BROKER || process.env.KAFKA_BOOTSTRAP_SERVERS || 'localhost:9092')],
  logLevel: logLevel.INFO
});

const consumer = kafka.consumer({ groupId: 'jiaa-data-group' });
const producer = kafka.producer();

export const connectKafka = async () => {
  await consumer.connect();
  await producer.connect();
  console.log('Kafka Consumer & Producer connected');
};

export { consumer, producer };
