import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useTeacherBatch } from './useTeacherBatch';
import { getBatchAttendanceReport } from '../api/teacherApi';
import { reportRows } from '../utils/attendanceAnalytics';

const EMPTY = { dates: [], records: [] };

export function useTeacherAttendanceReport({ batchId: batchIdOverride, enabled = true } = {}) {
  const { token } = useAuth();
  const { batchId: contextBatchId } = useTeacherBatch();
  const batchId = batchIdOverride ?? contextBatchId;
  const [report, setReport] = useState(EMPTY);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const activeRequest = useRef(null);

  const loadReport = useCallback(async () => {
    if (!batchId || !enabled || !token) return;
    activeRequest.current?.abort();
    const request = new AbortController();
    activeRequest.current = request;
    setRefreshing(true);
    setError('');
    try {
      const data = await getBatchAttendanceReport(batchId, token, request.signal);
      if (!request.signal.aborted) setReport(data || EMPTY);
    } catch (err) {
      if (!request.signal.aborted) {
        setError(err.response?.data?.error || 'Could not load attendance records.');
      }
    } finally {
      if (!request.signal.aborted) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [batchId, enabled, token]);

  useEffect(() => {
    setReport(EMPTY);
    setError('');
    setRefreshing(false);
    setLoading(Boolean(batchId && enabled && token));
    loadReport();
    return () => activeRequest.current?.abort();
  }, [batchId, enabled, token, loadReport]);

  const rows = useMemo(() => reportRows(report.records || []), [report.records]);

  return {
    dates: report.dates || [],
    records: report.records || [],
    rows,
    loading,
    refreshing,
    error,
    refresh: loadReport,
  };
}
