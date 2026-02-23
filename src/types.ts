export interface RawSensorData {
  '시리얼넘버': string;
  '멀칭 장소': string;
  '베터리': string;
  '일시': string;
  '토양수분': string;
  'EC': string;
  '지온': string;
}

export interface SensorData {
  serialNumber: string;
  location: string;
  battery: number;
  timestamp: Date;
  moisture: number;
  ec: number;
  temperature: number;
}

export interface AggregatedData {
  date: string;
  displayDate: string;
  moisture: number;
  ec: number;
  temperature: number;
  count: number;
}

export type MetricType = 'moisture' | 'ec' | 'temperature';
