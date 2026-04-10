/**
 * Realistic data generators for mock data.
 * These produce plausible-looking data, not just random strings.
 */

const firstNames = [
  'Alex', 'Jordan', 'Taylor', 'Morgan', 'Casey', 'Riley', 'Quinn',
  'Avery', 'Blake', 'Cameron', 'Dakota', 'Emerson', 'Finley', 'Harper',
  'Jamie', 'Kai', 'London', 'Micah', 'Noel', 'Parker', 'Reese', 'Sage',
];

const lastNames = [
  'Anderson', 'Chen', 'Garcia', 'Kim', 'Kowalski', 'Martinez', 'Nguyen',
  'Patel', 'Robinson', 'Santos', 'Schmidt', 'Suzuki', 'Thompson', 'Williams',
];

const companyNames = [
  'Acme Corp', 'TechFlow', 'DataVault', 'CloudPeak', 'Nexus Labs',
  'Prism Analytics', 'Quantum Dynamics', 'StreamLine', 'Vertex Solutions',
  'Wavelength', 'ZeroPoint', 'Atlas Systems', 'Forge Industries',
];

const projectNames = [
  'Dashboard Redesign', 'API Gateway', 'Mobile App v2', 'Data Pipeline',
  'Auth Service', 'Notification Engine', 'Analytics Platform', 'Search Service',
  'Payment Integration', 'User Onboarding', 'CI/CD Pipeline', 'Monitoring Setup',
];

const loremWords = [
  'lorem', 'ipsum', 'dolor', 'sit', 'amet', 'consectetur', 'adipiscing',
  'elit', 'sed', 'do', 'eiusmod', 'tempor', 'incididunt', 'labore',
  'magna', 'aliqua', 'enim', 'minim', 'veniam', 'nostrud', 'exercitation',
];

const statusOptions = ['active', 'pending', 'completed', 'archived', 'draft'];
const priorityOptions = ['low', 'medium', 'high', 'critical'];
const colorOptions = ['#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899'];

let counter = 0;

function nextId(): string {
  counter++;
  return `mock-${counter}-${Math.random().toString(36).slice(2, 8)}`;
}

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function pickN<T>(arr: T[], n: number): T[] {
  const shuffled = [...arr].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, n);
}

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomDate(daysBack: number = 365): string {
  const now = Date.now();
  const past = now - daysBack * 24 * 60 * 60 * 1000;
  return new Date(past + Math.random() * (now - past)).toISOString();
}

function sentence(wordCount: number = 8): string {
  const words = pickN(loremWords, wordCount);
  words[0] = words[0].charAt(0).toUpperCase() + words[0].slice(1);
  return words.join(' ') + '.';
}

function paragraph(sentenceCount: number = 3): string {
  return Array.from({ length: sentenceCount }, () => sentence(randomInt(6, 12))).join(' ');
}

export function generateUser() {
  const first = pick(firstNames);
  const last = pick(lastNames);
  return {
    id: nextId(),
    name: `${first} ${last}`,
    email: `${first.toLowerCase()}.${last.toLowerCase()}@example.com`,
    image: `https://api.dicebear.com/7.x/avataaars/svg?seed=${first}${last}`,
    role: pick(['admin', 'member', 'viewer']),
    createdAt: randomDate(730),
  };
}

export function generateProject() {
  return {
    id: nextId(),
    name: pick(projectNames),
    description: paragraph(2),
    status: pick(statusOptions),
    priority: pick(priorityOptions),
    owner: generateUser(),
    members: Array.from({ length: randomInt(2, 6) }, generateUser),
    createdAt: randomDate(365),
    updatedAt: randomDate(30),
    progress: randomInt(0, 100),
    tags: pickN(['frontend', 'backend', 'devops', 'design', 'mobile', 'api', 'security'], randomInt(1, 4)),
  };
}

export function generateTask() {
  return {
    id: nextId(),
    title: sentence(randomInt(4, 8)).slice(0, -1),
    description: paragraph(2),
    status: pick(statusOptions),
    priority: pick(priorityOptions),
    assignee: generateUser(),
    dueDate: randomDate(-30), // future date
    createdAt: randomDate(60),
    labels: pickN(['bug', 'feature', 'improvement', 'docs', 'testing'], randomInt(1, 3)),
    color: pick(colorOptions),
  };
}

export function generateNotification() {
  const types = ['info', 'warning', 'error', 'success'] as const;
  return {
    id: nextId(),
    type: pick([...types]),
    title: sentence(randomInt(3, 6)).slice(0, -1),
    message: sentence(randomInt(6, 12)),
    read: Math.random() > 0.5,
    createdAt: randomDate(7),
  };
}

export function generateStats() {
  return {
    totalUsers: randomInt(100, 50000),
    activeUsers: randomInt(50, 10000),
    totalProjects: randomInt(10, 500),
    completedTasks: randomInt(100, 5000),
    pendingTasks: randomInt(10, 500),
    revenue: randomInt(10000, 1000000),
    growth: (Math.random() * 40 - 10).toFixed(1) + '%',
    chartData: Array.from({ length: 12 }, (_, i) => ({
      month: new Date(2024, i, 1).toLocaleDateString('en-US', { month: 'short' }),
      value: randomInt(100, 1000),
    })),
  };
}

export function generateCompany() {
  return {
    id: nextId(),
    name: pick(companyNames),
    plan: pick(['free', 'starter', 'pro', 'enterprise']),
    members: randomInt(1, 100),
    createdAt: randomDate(730),
  };
}

/**
 * Given a field name, infer what kind of data to generate.
 */
export function generateForFieldName(fieldName: string): unknown {
  const lower = fieldName.toLowerCase();

  if (lower === 'id' || lower.endsWith('id') || lower.endsWith('_id')) return nextId();
  if (lower === 'name' || lower === 'title') return sentence(randomInt(2, 5)).slice(0, -1);
  if (lower === 'description' || lower === 'bio' || lower === 'body' || lower === 'content') return paragraph(2);
  if (lower === 'email') return `${pick(firstNames).toLowerCase()}@example.com`;
  if (lower === 'avatar' || lower === 'image' || lower === 'photo' || lower === 'picture') {
    return `https://api.dicebear.com/7.x/avataaars/svg?seed=${nextId()}`;
  }
  if (lower === 'url' || lower === 'link' || lower === 'href') return 'https://example.com';
  if (lower === 'phone') return `+1-555-${randomInt(100, 999)}-${randomInt(1000, 9999)}`;
  if (lower === 'date' || lower.endsWith('_at') || lower.endsWith('At') || lower === 'created' || lower === 'updated') {
    return randomDate(365);
  }
  if (lower === 'status') return pick(statusOptions);
  if (lower === 'priority') return pick(priorityOptions);
  if (lower === 'color') return pick(colorOptions);
  if (lower === 'count' || lower === 'total' || lower === 'amount' || lower === 'quantity') return randomInt(0, 1000);
  if (lower === 'price' || lower === 'cost') return parseFloat((Math.random() * 999 + 1).toFixed(2));
  if (lower === 'percentage' || lower === 'progress' || lower === 'rate') return randomInt(0, 100);
  if (lower.includes('flag') || lower.startsWith('is') || lower.startsWith('has') || lower.startsWith('can')) {
    return Math.random() > 0.5;
  }
  if (lower === 'tags' || lower === 'labels' || lower === 'categories') {
    return pickN(['alpha', 'beta', 'gamma', 'delta', 'epsilon'], randomInt(1, 3));
  }
  if (lower === 'user' || lower === 'author' || lower === 'owner' || lower === 'assignee') return generateUser();
  if (lower === 'project') return generateProject();

  // Default: return a realistic string
  return sentence(randomInt(3, 6)).slice(0, -1);
}

/**
 * Generate a mock array of items.
 */
export function generateArray(
  itemGenerator: () => unknown,
  count?: number,
  scenario?: string
): unknown[] {
  if (scenario === 'empty') return [];
  const n = count ?? randomInt(3, 8);
  return Array.from({ length: n }, itemGenerator);
}

/**
 * Generate mock data matching an inferred shape.
 */
export function generateFromShape(shape: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, typeHint] of Object.entries(shape)) {
    if (typeof typeHint === 'string') {
      switch (typeHint) {
        case 'string': result[key] = generateForFieldName(key); break;
        case 'number': result[key] = randomInt(0, 1000); break;
        case 'boolean': result[key] = Math.random() > 0.5; break;
        default: result[key] = generateForFieldName(key);
      }
    } else if (Array.isArray(typeHint)) {
      result[key] = generateArray(() => generateForFieldName(key), 3);
    } else if (typeof typeHint === 'object' && typeHint !== null) {
      result[key] = generateFromShape(typeHint as Record<string, unknown>);
    } else {
      result[key] = generateForFieldName(key);
    }
  }
  return result;
}
