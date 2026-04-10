'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useSession } from 'next-auth/react';

interface Project {
  id: string;
  name: string;
  description: string;
  status: string;
  priority: string;
  progress: number;
  owner: {
    id: string;
    name: string;
    email: string;
    image: string;
  };
  members: Array<{
    id: string;
    name: string;
    image: string;
  }>;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

interface Task {
  id: string;
  title: string;
  status: string;
  priority: string;
  assignee: {
    name: string;
    image: string;
  };
  dueDate: string;
}

export default function ProjectDetailPage() {
  const { id } = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { data: session, status: authStatus } = useSession();

  const [project, setProject] = useState<Project | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const tab = searchParams.get('tab') || 'overview';

  useEffect(() => {
    async function fetchData() {
      try {
        const [projectRes, tasksRes] = await Promise.all([
          fetch(`/api/projects/${id}`),
          fetch(`/api/projects/${id}/tasks`),
        ]);

        if (!projectRes.ok) throw new Error('Failed to fetch project');
        if (!tasksRes.ok) throw new Error('Failed to fetch tasks');

        const projectData = await projectRes.json();
        const tasksData = await tasksRes.json();

        setProject(projectData);
        setTasks(tasksData.data || []);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error');
      } finally {
        setLoading(false);
      }
    }

    fetchData();
  }, [id]);

  if (authStatus === 'unauthenticated') {
    return (
      <div style={styles.container}>
        <div style={styles.authError}>
          <h2>Authentication Required</h2>
          <p>Please sign in to view this project.</p>
          <button onClick={() => router.push('/auth/signin')} style={styles.button}>
            Sign In
          </button>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div style={styles.container}>
        <div style={styles.skeleton}>
          <div style={{ ...styles.skeletonBar, width: '60%' }} />
          <div style={{ ...styles.skeletonBar, width: '40%' }} />
          <div style={{ ...styles.skeletonBar, width: '80%' }} />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div style={styles.container}>
        <div style={styles.errorCard}>
          <h2 style={{ color: '#ef4444' }}>Error</h2>
          <p>{error}</p>
          <button onClick={() => window.location.reload()} style={styles.button}>
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (!project) return null;

  return (
    <div style={styles.container}>
      {/* Header */}
      <header style={styles.header}>
        <div style={styles.headerLeft}>
          <button onClick={() => router.back()} style={styles.backButton}>
            &larr; Back
          </button>
          <div>
            <h1 style={styles.title}>{project.name}</h1>
            <p style={styles.subtitle}>{project.description}</p>
          </div>
        </div>
        <div style={styles.headerRight}>
          <span style={{
            ...styles.badge,
            background: project.status === 'active' ? '#10b981' : '#6b7280',
          }}>
            {project.status}
          </span>
          <span style={{
            ...styles.badge,
            background: project.priority === 'high' ? '#ef4444' : project.priority === 'medium' ? '#f59e0b' : '#3b82f6',
          }}>
            {project.priority}
          </span>
        </div>
      </header>

      {/* User info */}
      <div style={styles.userInfo}>
        Logged in as <strong>{session?.user?.name}</strong> ({session?.user?.email})
      </div>

      {/* Progress bar */}
      <div style={styles.progressContainer}>
        <div style={styles.progressLabel}>
          <span>Progress</span>
          <span>{project.progress}%</span>
        </div>
        <div style={styles.progressTrack}>
          <div style={{ ...styles.progressBar, width: `${project.progress}%` }} />
        </div>
      </div>

      {/* Tabs */}
      <div style={styles.tabs}>
        {['overview', 'tasks', 'members'].map(t => (
          <button
            key={t}
            onClick={() => router.push(`?tab=${t}`)}
            style={{
              ...styles.tab,
              borderBottom: tab === t ? '2px solid #3b82f6' : '2px solid transparent',
              color: tab === t ? '#3b82f6' : '#6b7280',
            }}
          >
            {t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {tab === 'overview' && (
        <div style={styles.grid}>
          <div style={styles.card}>
            <h3 style={styles.cardTitle}>Project Details</h3>
            <div style={styles.detailRow}>
              <span style={styles.detailLabel}>Owner</span>
              <span>{project.owner.name}</span>
            </div>
            <div style={styles.detailRow}>
              <span style={styles.detailLabel}>Created</span>
              <span>{new Date(project.createdAt).toLocaleDateString()}</span>
            </div>
            <div style={styles.detailRow}>
              <span style={styles.detailLabel}>Updated</span>
              <span>{new Date(project.updatedAt).toLocaleDateString()}</span>
            </div>
            <div style={styles.detailRow}>
              <span style={styles.detailLabel}>Tags</span>
              <div style={{ display: 'flex', gap: 4 }}>
                {project.tags.map(tag => (
                  <span key={tag} style={styles.tag}>{tag}</span>
                ))}
              </div>
            </div>
          </div>

          <div style={styles.card}>
            <h3 style={styles.cardTitle}>Recent Tasks</h3>
            {tasks.slice(0, 5).map(task => (
              <div key={task.id} style={styles.taskRow}>
                <span style={{
                  ...styles.taskStatus,
                  background: task.status === 'completed' ? '#10b981' : task.status === 'active' ? '#3b82f6' : '#6b7280',
                }} />
                <span style={styles.taskTitle}>{task.title}</span>
                <span style={styles.taskPriority}>{task.priority}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === 'tasks' && (
        <div style={styles.card}>
          <h3 style={styles.cardTitle}>All Tasks ({tasks.length})</h3>
          {tasks.map(task => (
            <div key={task.id} style={styles.taskRow}>
              <span style={{
                ...styles.taskStatus,
                background: task.status === 'completed' ? '#10b981' : task.status === 'active' ? '#3b82f6' : '#6b7280',
              }} />
              <div style={{ flex: 1 }}>
                <div style={styles.taskTitle}>{task.title}</div>
                <div style={{ fontSize: 12, color: '#6b7280' }}>
                  {task.assignee.name} &middot; Due {new Date(task.dueDate).toLocaleDateString()}
                </div>
              </div>
              <span style={styles.taskPriority}>{task.priority}</span>
            </div>
          ))}
        </div>
      )}

      {tab === 'members' && (
        <div style={styles.card}>
          <h3 style={styles.cardTitle}>Team Members ({project.members.length})</h3>
          <div style={styles.membersGrid}>
            {project.members.map(member => (
              <div key={member.id} style={styles.memberCard}>
                <img src={member.image} alt={member.name} style={styles.avatar} />
                <span>{member.name}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    maxWidth: 960,
    margin: '0 auto',
    padding: '24px 16px',
    fontFamily: 'system-ui, -apple-system, sans-serif',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 24,
  },
  headerLeft: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 16,
  },
  headerRight: {
    display: 'flex',
    gap: 8,
  },
  backButton: {
    background: 'none',
    border: '1px solid #e5e7eb',
    borderRadius: 6,
    padding: '6px 12px',
    cursor: 'pointer',
    fontSize: 14,
  },
  title: {
    fontSize: 28,
    fontWeight: 700,
    margin: 0,
  },
  subtitle: {
    color: '#6b7280',
    margin: '4px 0 0',
    fontSize: 14,
  },
  badge: {
    color: 'white',
    padding: '4px 12px',
    borderRadius: 12,
    fontSize: 12,
    fontWeight: 600,
    textTransform: 'uppercase' as const,
  },
  userInfo: {
    background: '#f3f4f6',
    padding: '8px 16px',
    borderRadius: 8,
    fontSize: 13,
    marginBottom: 24,
    color: '#374151',
  },
  progressContainer: {
    marginBottom: 24,
  },
  progressLabel: {
    display: 'flex',
    justifyContent: 'space-between',
    fontSize: 13,
    color: '#6b7280',
    marginBottom: 6,
  },
  progressTrack: {
    height: 8,
    background: '#e5e7eb',
    borderRadius: 4,
    overflow: 'hidden',
  },
  progressBar: {
    height: '100%',
    background: 'linear-gradient(90deg, #3b82f6, #10b981)',
    borderRadius: 4,
    transition: 'width 0.5s',
  },
  tabs: {
    display: 'flex',
    gap: 4,
    borderBottom: '1px solid #e5e7eb',
    marginBottom: 24,
  },
  tab: {
    background: 'none',
    border: 'none',
    padding: '8px 16px',
    cursor: 'pointer',
    fontSize: 14,
    fontWeight: 500,
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(400px, 1fr))',
    gap: 20,
  },
  card: {
    border: '1px solid #e5e7eb',
    borderRadius: 12,
    padding: 20,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: 600,
    marginTop: 0,
    marginBottom: 16,
  },
  detailRow: {
    display: 'flex',
    justifyContent: 'space-between',
    padding: '8px 0',
    borderBottom: '1px solid #f3f4f6',
    fontSize: 14,
  },
  detailLabel: {
    color: '#6b7280',
    fontWeight: 500,
  },
  tag: {
    background: '#e5e7eb',
    padding: '2px 8px',
    borderRadius: 4,
    fontSize: 11,
  },
  taskRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    padding: '10px 0',
    borderBottom: '1px solid #f3f4f6',
  },
  taskStatus: {
    width: 8,
    height: 8,
    borderRadius: '50%',
    flexShrink: 0,
  },
  taskTitle: {
    flex: 1,
    fontSize: 14,
  },
  taskPriority: {
    fontSize: 11,
    color: '#6b7280',
    textTransform: 'uppercase' as const,
  },
  membersGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
    gap: 12,
  },
  memberCard: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    padding: 12,
    border: '1px solid #e5e7eb',
    borderRadius: 8,
    fontSize: 14,
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: '50%',
    background: '#e5e7eb',
  },
  button: {
    background: '#3b82f6',
    color: 'white',
    border: 'none',
    borderRadius: 8,
    padding: '10px 20px',
    fontSize: 14,
    fontWeight: 500,
    cursor: 'pointer',
  },
  skeleton: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 16,
    padding: 40,
  },
  skeletonBar: {
    height: 20,
    background: '#e5e7eb',
    borderRadius: 4,
    animation: 'pulse 1.5s infinite',
  },
  authError: {
    textAlign: 'center' as const,
    padding: 60,
  },
  errorCard: {
    textAlign: 'center' as const,
    padding: 40,
    border: '1px solid #fecaca',
    borderRadius: 12,
    background: '#fef2f2',
  },
};
