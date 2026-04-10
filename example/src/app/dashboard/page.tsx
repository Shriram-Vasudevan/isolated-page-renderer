'use client';

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';

interface DashboardStats {
  totalUsers: number;
  activeUsers: number;
  totalProjects: number;
  completedTasks: number;
  pendingTasks: number;
  revenue: number;
  growth: string;
  chartData: Array<{ month: string; value: number }>;
}

interface Notification {
  id: string;
  type: 'info' | 'warning' | 'error' | 'success';
  title: string;
  message: string;
  read: boolean;
  createdAt: string;
}

export default function DashboardPage() {
  const { data: session } = useSession();
  const router = useRouter();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadDashboard() {
      try {
        const [statsRes, notifRes] = await Promise.all([
          fetch('/api/dashboard/stats'),
          fetch('/api/notifications'),
        ]);

        const statsData = await statsRes.json();
        const notifData = await notifRes.json();

        setStats(statsData);
        setNotifications(notifData.data || []);
      } catch (err) {
        console.error('Failed to load dashboard:', err);
      } finally {
        setLoading(false);
      }
    }

    loadDashboard();
  }, []);

  if (loading) {
    return <div style={{ padding: 40, textAlign: 'center', fontFamily: 'system-ui' }}>Loading dashboard...</div>;
  }

  return (
    <div style={{ maxWidth: 1200, margin: '0 auto', padding: '24px 16px', fontFamily: 'system-ui' }}>
      <header style={{ marginBottom: 32 }}>
        <h1 style={{ fontSize: 32, margin: 0 }}>Dashboard</h1>
        <p style={{ color: '#6b7280', margin: '4px 0 0' }}>
          Welcome back, {session?.user?.name || 'User'}
        </p>
      </header>

      {/* Stats Grid */}
      {stats && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 32 }}>
          {[
            { label: 'Total Users', value: stats.totalUsers.toLocaleString(), color: '#3b82f6' },
            { label: 'Active Projects', value: stats.totalProjects, color: '#10b981' },
            { label: 'Completed Tasks', value: stats.completedTasks.toLocaleString(), color: '#8b5cf6' },
            { label: 'Growth', value: stats.growth, color: '#f59e0b' },
          ].map(stat => (
            <div key={stat.label} style={{
              border: '1px solid #e5e7eb', borderRadius: 12, padding: 20,
              borderLeft: `4px solid ${stat.color}`,
            }}>
              <div style={{ color: '#6b7280', fontSize: 13, marginBottom: 4 }}>{stat.label}</div>
              <div style={{ fontSize: 28, fontWeight: 700 }}>{stat.value}</div>
            </div>
          ))}
        </div>
      )}

      {/* Notifications */}
      <div style={{ border: '1px solid #e5e7eb', borderRadius: 12, padding: 20 }}>
        <h3 style={{ marginTop: 0 }}>Recent Notifications ({notifications.length})</h3>
        {notifications.length === 0 ? (
          <p style={{ color: '#6b7280', textAlign: 'center', padding: 20 }}>No notifications</p>
        ) : (
          notifications.slice(0, 5).map(notif => (
            <div key={notif.id} style={{
              padding: '12px 0', borderBottom: '1px solid #f3f4f6',
              display: 'flex', gap: 12, alignItems: 'flex-start',
              opacity: notif.read ? 0.6 : 1,
            }}>
              <span style={{
                width: 8, height: 8, borderRadius: '50%', marginTop: 6, flexShrink: 0,
                background: notif.type === 'error' ? '#ef4444' :
                  notif.type === 'warning' ? '#f59e0b' :
                  notif.type === 'success' ? '#10b981' : '#3b82f6',
              }} />
              <div>
                <div style={{ fontWeight: 500, fontSize: 14 }}>{notif.title}</div>
                <div style={{ color: '#6b7280', fontSize: 13 }}>{notif.message}</div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
