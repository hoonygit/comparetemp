/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo, useCallback, useRef } from 'react';
import Papa from 'papaparse';
import { jsPDF } from 'jspdf';
import html2canvas from 'html2canvas';
import { 
  format, 
  parse, 
  isWithinInterval, 
  differenceInDays, 
  startOfDay, 
  startOfWeek,
  startOfHour,
  isValid
} from 'date-fns';
import { 
  LineChart, 
  Line, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  Legend, 
  ResponsiveContainer 
} from 'recharts';
import { 
  Upload, 
  Filter, 
  Calendar, 
  MapPin, 
  Activity, 
  ChevronDown,
  Info,
  Download,
  Database
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { SensorData, RawSensorData, AggregatedData, MetricType } from './types';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export default function App() {
  const [data, setData] = useState<SensorData[]>([]);
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');
  const [selectedLocations, setSelectedLocations] = useState<string[]>([]);
  const [selectedMetrics, setSelectedMetrics] = useState<MetricType[]>(['moisture', 'ec', 'temperature']);
  const [isUploading, setIsUploading] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  
  const reportRef = useRef<HTMLDivElement>(null);

  // CSV Parsing
  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (file.size > 10 * 1024 * 1024) {
      alert('파일 크기가 너무 큽니다 (최대 10MB).');
      return;
    }

    setIsUploading(true);
    Papa.parse<RawSensorData>(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        try {
          const parsedData: SensorData[] = results.data.map((row) => {
            const date = new Date(row['일시']);
            return {
              serialNumber: row['시리얼넘버'] || 'N/A',
              location: row['멀칭 장소'] || 'Unknown',
              battery: parseFloat(row['베터리']) || 0,
              timestamp: date,
              moisture: parseFloat(row['토양수분']) || 0,
              ec: parseFloat(row['EC']) || 0,
              temperature: parseFloat(row['지온']) || 0,
            };
          }).filter(d => isValid(d.timestamp));

          if (parsedData.length === 0) {
            alert('유효한 데이터가 없습니다. CSV 형식을 확인해주세요.');
            setIsUploading(false);
            return;
          }

          setData(parsedData);
          
          const dates = parsedData.map(d => d.timestamp.getTime());
          setStartDate(format(new Date(Math.min(...dates)), 'yyyy-MM-dd'));
          setEndDate(format(new Date(Math.max(...dates)), 'yyyy-MM-dd'));
          
          // Initialize with all locations
          const uniqueLocs = Array.from(new Set(parsedData.map(d => d.location)));
          setSelectedLocations(uniqueLocs);
        } catch (err) {
          console.error('Data processing error:', err);
          alert('데이터 처리 중 오류가 발생했습니다.');
        } finally {
          setIsUploading(false);
        }
      },
      error: (error) => {
        console.error('CSV Parsing Error:', error);
        alert('CSV 파일을 읽는 중 오류가 발생했습니다.');
        setIsUploading(false);
      }
    });
  };

  const clearData = () => {
    if (window.confirm('모든 데이터를 삭제하시겠습니까?')) {
      setData([]);
      setStartDate('');
      setEndDate('');
      setSelectedLocations([]);
    }
  };

  const locations = useMemo(() => {
    return Array.from(new Set(data.map(d => d.location)));
  }, [data]);

  const filteredAndAggregatedData = useMemo(() => {
    if (data.length === 0 || !startDate || !endDate) return [];

    const start = new Date(startDate);
    const end = new Date(endDate);
    const daysDiff = differenceInDays(end, start);
    const aggregationMode = daysDiff > 31 ? 'weekly' : daysDiff > 7 ? 'daily' : 'hourly';

    // Filter by date and selected locations
    const dateFiltered = data.filter(d => 
      isWithinInterval(d.timestamp, { start, end }) && 
      (selectedLocations.length === 0 || selectedLocations.includes(d.location))
    );

    // Aggregate by time and location
    const timeLocationGroups: Record<string, Record<string, any>> = {};

    dateFiltered.forEach(d => {
      let timeKey;
      if (aggregationMode === 'weekly') {
        timeKey = format(startOfWeek(d.timestamp), 'yyyy-MM-dd');
      } else if (aggregationMode === 'daily') {
        timeKey = format(startOfDay(d.timestamp), 'yyyy-MM-dd');
      } else {
        timeKey = format(startOfHour(d.timestamp), 'yyyy-MM-dd HH:00');
      }
      
      if (!timeLocationGroups[timeKey]) timeLocationGroups[timeKey] = {};
      if (!timeLocationGroups[timeKey][d.location]) {
        timeLocationGroups[timeKey][d.location] = { moisture: 0, ec: 0, temperature: 0, count: 0 };
      }

      const locGroup = timeLocationGroups[timeKey][d.location];
      locGroup.moisture += d.moisture;
      locGroup.ec += d.ec;
      locGroup.temperature += d.temperature;
      locGroup.count += 1;
    });

    // Flatten for Recharts
    return Object.entries(timeLocationGroups).map(([timeKey, locs]) => {
      let displayDate;
      if (aggregationMode === 'weekly') {
        displayDate = `${format(new Date(timeKey), 'MM/dd')} (Week)`;
      } else if (aggregationMode === 'daily') {
        displayDate = format(new Date(timeKey), 'MM/dd');
      } else {
        displayDate = format(new Date(timeKey), 'MM/dd HH:mm');
      }

      const result: any = {
        date: timeKey,
        displayDate,
      };

      // All locations view: Location_Metric keys
      Object.entries(locs).forEach(([loc, stats]) => {
        result[`${loc}_moisture`] = Number((stats.moisture / stats.count).toFixed(2));
        result[`${loc}_ec`] = Number((stats.ec / stats.count).toFixed(2));
        result[`${loc}_temperature`] = Number((stats.temperature / stats.count).toFixed(2));
      });
      
      return result;
    }).sort((a, b) => a.date.localeCompare(b.date));
  }, [data, startDate, endDate, selectedLocations]);

  const exportToPDF = async () => {
    if (!reportRef.current) return;
    setIsExporting(true);
    try {
      const canvas = await html2canvas(reportRef.current, {
        scale: 2,
        useCORS: true,
        logging: false,
        backgroundColor: '#F8FAFC'
      });
      
      const imgData = canvas.toDataURL('image/png');
      const pdf = new jsPDF('p', 'mm', 'a4');
      const imgProps = pdf.getImageProperties(imgData);
      const pdfWidth = pdf.internal.pageSize.getWidth();
      const pdfHeight = (imgProps.height * pdfWidth) / imgProps.width;
      
      pdf.addImage(imgData, 'PNG', 0, 0, pdfWidth, pdfHeight);
      pdf.save(`sensor-report-${format(new Date(), 'yyyyMMdd-HHmm')}.pdf`);
    } catch (error) {
      console.error('PDF Export Error:', error);
    } finally {
      setIsExporting(false);
    }
  };

  const toggleLocation = (loc: string) => {
    setSelectedLocations(prev => 
      prev.includes(loc) 
        ? prev.filter(l => l !== loc)
        : [...prev, loc]
    );
  };

  const toggleAllLocations = () => {
    if (selectedLocations.length === locations.length) {
      setSelectedLocations([]);
    } else {
      setSelectedLocations(locations);
    }
  };

  const toggleMetric = (metric: MetricType) => {
    setSelectedMetrics(prev => 
      prev.includes(metric) 
        ? prev.filter(m => m !== metric)
        : [...prev, metric]
    );
  };

  const metricConfig = {
    moisture: { label: '토양수분', color: '#3b82f6', unit: '%' },
    ec: { label: 'EC', color: '#10b981', unit: 'dS/m' },
    temperature: { label: '지온', color: '#f59e0b', unit: '°C' }
  };

  return (
    <div className="min-h-screen bg-[#F8FAFC] text-[#1E293B] font-sans selection:bg-blue-100">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="bg-blue-600 p-2 rounded-lg">
              <Database className="w-5 h-5 text-white" />
            </div>
            <h1 className="text-xl font-bold tracking-tight text-slate-900">Sensor Analytics</h1>
          </div>
          
          <div className="flex items-center gap-4">
            {data.length > 0 && (
              <button 
                onClick={clearData}
                className="text-xs font-medium text-slate-500 hover:text-red-500 transition-colors"
              >
                데이터 초기화
              </button>
            )}
            <label className="relative inline-flex items-center cursor-pointer group">
              <input 
                type="file" 
                accept=".csv" 
                onChange={handleFileUpload} 
                className="sr-only"
              />
              <div className="flex items-center gap-2 px-4 py-2 bg-slate-900 text-white rounded-full text-sm font-medium hover:bg-slate-800 transition-all shadow-sm group-hover:scale-105 active:scale-95">
                <Upload className="w-4 h-4" />
                {data.length > 0 ? '데이터 변경' : 'CSV 업로드'}
              </div>
            </label>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8" ref={reportRef}>
        {data.length === 0 ? (
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex flex-col items-center justify-center min-h-[60vh] text-center"
          >
            <div className="w-24 h-24 bg-blue-50 rounded-full flex items-center justify-center mb-6">
              <Upload className="w-10 h-10 text-blue-500" />
            </div>
            <h2 className="text-2xl font-bold text-slate-900 mb-2">데이터를 시작하세요</h2>
            <p className="text-slate-500 max-w-md mb-8">
              센서 데이터 CSV 파일을 업로드하여 멀칭 장소별 토양수분, EC, 지온의 변화를 분석하고 시각화합니다.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-left max-w-2xl w-full">
              {[
                { icon: Calendar, title: '기간별 분석', desc: '일별/주별 자동 집계' },
                { icon: MapPin, title: '장소별 필터', desc: '특정 멀칭 장소 선택' },
                { icon: Activity, title: '다중 지표', desc: '수분, EC, 지온 비교' },
              ].map((item, i) => (
                <div key={i} className="p-4 bg-white rounded-2xl border border-slate-200 shadow-sm">
                  <item.icon className="w-5 h-5 text-blue-600 mb-2" />
                  <h3 className="font-semibold text-slate-900">{item.title}</h3>
                  <p className="text-xs text-slate-500 mt-1">{item.desc}</p>
                </div>
              ))}
            </div>
          </motion.div>
        ) : (
          <div className="space-y-6">
            {/* Filters Section */}
            <section className="grid grid-cols-1 lg:grid-cols-4 gap-6">
              <div className="lg:col-span-3 bg-white p-6 rounded-3xl border border-slate-200 shadow-sm space-y-6">
                <div className="flex items-center gap-2 text-slate-900 font-semibold mb-2">
                  <Filter className="w-4 h-4" />
                  <span>데이터 필터</span>
                </div>
                
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  {/* Date Range */}
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-slate-400 uppercase tracking-wider">검색 기간</label>
                    <div className="flex items-center gap-2">
                      <input 
                        type="date" 
                        value={startDate}
                        onChange={(e) => setStartDate(e.target.value)}
                        className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 outline-none transition-all"
                      />
                      <span className="text-slate-400">~</span>
                      <input 
                        type="date" 
                        value={endDate}
                        onChange={(e) => setEndDate(e.target.value)}
                        className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 outline-none transition-all"
                      />
                    </div>
                  </div>

                  {/* Location Filter */}
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-slate-400 uppercase tracking-wider">멀칭 장소</label>
                    <div className="flex flex-wrap gap-2">
                      <button
                        onClick={toggleAllLocations}
                        className={cn(
                          "px-3 py-1.5 rounded-full text-xs font-medium transition-all border",
                          selectedLocations.length === locations.length
                            ? "bg-slate-900 text-white border-slate-900 shadow-sm"
                            : "bg-white text-slate-500 border-slate-200 hover:border-slate-300"
                        )}
                      >
                        전체
                      </button>
                      {locations.map(loc => (
                        <button
                          key={loc}
                          onClick={() => toggleLocation(loc)}
                          className={cn(
                            "px-3 py-1.5 rounded-full text-xs font-medium transition-all border",
                            selectedLocations.includes(loc)
                              ? "bg-blue-600 text-white border-blue-600 shadow-sm"
                              : "bg-white text-slate-500 border-slate-200 hover:border-slate-300"
                          )}
                        >
                          {loc}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Metric Selection */}
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-slate-400 uppercase tracking-wider">시각화 지표</label>
                    <div className="flex flex-wrap gap-2">
                      {(Object.keys(metricConfig) as MetricType[]).map(metric => (
                        <button
                          key={metric}
                          onClick={() => toggleMetric(metric)}
                          className={cn(
                            "px-3 py-1.5 rounded-full text-xs font-medium transition-all border",
                            selectedMetrics.includes(metric)
                              ? "bg-slate-900 text-white border-slate-900 shadow-sm"
                              : "bg-white text-slate-500 border-slate-200 hover:border-slate-300"
                          )}
                        >
                          {metricConfig[metric].label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              {/* Stats Summary */}
              <div className="bg-slate-900 p-6 rounded-3xl text-white flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between mb-4">
                    <span className="text-slate-400 text-xs font-bold uppercase tracking-wider">분석 요약</span>
                    <Info className="w-4 h-4 text-slate-500" />
                  </div>
                  <div className="space-y-4">
                    <div>
                      <div className="text-3xl font-bold">{filteredAndAggregatedData.length}</div>
                      <div className="text-slate-400 text-xs mt-1">
                        데이터 포인트 ({
                          differenceInDays(new Date(endDate), new Date(startDate)) > 31 
                            ? '주간 평균' 
                            : differenceInDays(new Date(endDate), new Date(startDate)) > 7 
                              ? '일간 평균' 
                              : '시간별 평균'
                        })
                      </div>
                    </div>
                    <div className="pt-4 border-t border-slate-800">
                      <div className="flex justify-between items-center text-sm">
                        <span className="text-slate-400">선택된 장소</span>
                        <span className="font-medium">{selectedLocations.length === locations.length ? '전체' : `${selectedLocations.length}개`}</span>
                      </div>
                    </div>
                  </div>
                </div>
                <button 
                  onClick={exportToPDF}
                  disabled={isExporting}
                  className="mt-6 w-full py-2 bg-white/10 hover:bg-white/20 rounded-xl text-sm font-medium transition-all flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  {isExporting ? (
                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  ) : (
                    <Download className="w-4 h-4" />
                  )}
                  {isExporting ? '내보내는 중...' : '보고서 내보내기'}
                </button>
              </div>
            </section>

            {/* Chart Section */}
            <section className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm min-h-[500px]">
              <div className="flex items-center justify-between mb-8">
                <div>
                  <h3 className="text-lg font-bold text-slate-900">시계열 트렌드 분석</h3>
                  <p className="text-sm text-slate-500">멀칭 장소 및 기간에 따른 센서 데이터 변화 추이</p>
                </div>
                <div className="flex items-center gap-4">
                  {selectedMetrics.map(metric => (
                    <div key={metric} className="flex items-center gap-2">
                      <div className="w-3 h-3 rounded-full" style={{ backgroundColor: metricConfig[metric].color }} />
                      <span className="text-xs font-medium text-slate-600">{metricConfig[metric].label}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="h-[400px] w-full">
                {filteredAndAggregatedData.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={filteredAndAggregatedData} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                      <XAxis 
                        dataKey="displayDate" 
                        axisLine={false}
                        tickLine={false}
                        tick={{ fontSize: 12, fill: '#64748b' }}
                        dy={10}
                      />
                      <YAxis 
                        axisLine={false}
                        tickLine={false}
                        tick={{ fontSize: 12, fill: '#64748b' }}
                      />
                      <Tooltip 
                        contentStyle={{ 
                          borderRadius: '16px', 
                          border: 'none', 
                          boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)',
                          padding: '12px'
                        }}
                        itemStyle={{ fontSize: '12px', fontWeight: 600 }}
                        labelStyle={{ marginBottom: '8px', fontWeight: 700, color: '#1e293b' }}
                      />
                      <Legend verticalAlign="top" height={36}/>
                      
                      {locations.filter(l => selectedLocations.includes(l)).map((loc, locIdx) => (
                        (Object.keys(metricConfig) as MetricType[]).map((metric, metricIdx) => {
                          if (!selectedMetrics.includes(metric)) return null;
                          
                          // High contrast palette
                          const palette = [
                            '#2563eb', '#16a34a', '#d97706', '#dc2626', '#7c3aed', 
                            '#db2777', '#0891b2', '#4f46e5', '#059669', '#ca8a04',
                            '#e11d48', '#9333ea', '#c026d3', '#0d9488', '#2563eb'
                          ];
                          
                          // Unique index for each line based on all possible combinations
                          const colorIdx = (locIdx * Object.keys(metricConfig).length + metricIdx) % palette.length;
                          const color = palette[colorIdx];
                          
                          return (
                            <Line 
                              key={`${loc}_${metric}`}
                              type="monotone" 
                              dataKey={`${loc}_${metric}`} 
                              name={`${loc} - ${metricConfig[metric].label}`}
                              stroke={color} 
                              strokeWidth={2}
                              dot={{ r: 3, fill: color, strokeWidth: 1, stroke: '#fff' }}
                              activeDot={{ r: 5, strokeWidth: 0 }}
                              connectNulls
                            />
                          );
                        })
                      ))}
                    </LineChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="h-full flex items-center justify-center text-slate-400 italic">
                    선택한 조건에 해당하는 데이터가 없습니다.
                  </div>
                )}
              </div>
            </section>

            {/* Data Table Preview */}
            <section className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden">
              <div className="p-6 border-b border-slate-100 flex items-center justify-between">
                <h3 className="font-bold text-slate-900">상세 데이터 내역 (최근 10건)</h3>
                <span className="text-xs text-slate-400">총 {data.length}개의 레코드</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="bg-slate-50 text-slate-500 font-medium">
                      <th className="px-6 py-4">일시</th>
                      <th className="px-6 py-4">장소</th>
                      <th className="px-6 py-4">토양수분</th>
                      <th className="px-6 py-4">EC</th>
                      <th className="px-6 py-4">지온</th>
                      <th className="px-6 py-4">베터리</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {data.slice(0, 10).map((row, i) => (
                      <tr key={i} className="hover:bg-slate-50 transition-colors">
                        <td className="px-6 py-4 text-slate-600">{format(row.timestamp, 'yyyy-MM-dd HH:mm')}</td>
                        <td className="px-6 py-4 font-medium text-slate-900">{row.location}</td>
                        <td className="px-6 py-4 text-blue-600 font-semibold">{row.moisture}%</td>
                        <td className="px-6 py-4 text-emerald-600 font-semibold">{row.ec}</td>
                        <td className="px-6 py-4 text-amber-600 font-semibold">{row.temperature}°C</td>
                        <td className="px-6 py-4 text-slate-500">{row.battery}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </div>
        )}
      </main>

      {/* Loading Overlay */}
      <AnimatePresence>
        {isUploading && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center"
          >
            <div className="bg-white p-8 rounded-3xl shadow-2xl flex flex-col items-center gap-4">
              <div className="w-12 h-12 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
              <p className="font-bold text-slate-900">데이터 처리 중...</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
