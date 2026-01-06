import { InfluxDB, Point } from '@influxdata/influxdb-client';
import dotenv from 'dotenv';

dotenv.config();

const url = process.env.INFLUX_URL || 'http://localhost:8086';
const token = process.env.INFLUX_TOKEN || 'my-token';
const org = process.env.INFLUX_ORG || 'jiaa';
const bucket = process.env.INFLUX_BUCKET || 'sensor_data';

const influxDB = new InfluxDB({ url, token });
const writeApi = influxDB.getWriteApi(org, bucket, 'ns', {
    flushInterval: 1000,
    batchSize: 1
});

export { writeApi, Point, influxDB };
