export default function HomePage() {
  const features = [
    {
      title: 'Organizations',
      description:
        'Manage multiple tenant organizations with isolated data, custom domains, and enterprise-grade multi-tenancy.',
    },
    {
      title: 'Role-Based Access Control',
      description:
        'Granular RBAC permissions to control user access across projects, workspaces, and tenant resources.',
    },
    {
      title: 'Project Management',
      description:
        'Plan, track, and manage projects, tasks, and workflows with interactive dashboards and status tracking.',
    },
    {
      title: 'Real-Time Collaboration',
      description:
        'Work together seamlessly with real-time updates, comments, and live notifications powered by WebSockets.',
    },
  ];

  return (
    <main
      style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '3rem 1.5rem',
      }}
    >
      <div
        style={{
          maxWidth: '900px',
          width: '100%',
          textAlign: 'center',
        }}
      >
        <div
          style={{
            display: 'inline-block',
            padding: '0.375rem 1rem',
            borderRadius: '9999px',
            backgroundColor: 'rgba(56, 189, 248, 0.1)',
            color: 'var(--accent)',
            fontSize: '0.875rem',
            fontWeight: 600,
            marginBottom: '1.5rem',
            border: '1px solid rgba(56, 189, 248, 0.2)',
          }}
        >
          Phase 1 — Initialization & Development Environment
        </div>

        <h1
          style={{
            fontSize: '2.5rem',
            fontWeight: 800,
            lineHeight: 1.2,
            marginBottom: '1.5rem',
            letterSpacing: '-0.025em',
          }}
        >
          Multi-Tenant SaaS Project Management Platform
        </h1>

        <p
          style={{
            fontSize: '1.125rem',
            color: 'var(--text-muted)',
            marginBottom: '3rem',
            lineHeight: 1.6,
          }}
        >
          A high-performance enterprise project management system built for scalability,
          multi-tenant isolation, and real-time team collaboration.
        </p>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))',
            gap: '1.5rem',
            textAlign: 'left',
          }}
        >
          {features.map((feature) => (
            <div
              key={feature.title}
              style={{
                backgroundColor: 'var(--card-bg)',
                border: '1px solid var(--card-border)',
                borderRadius: '0.75rem',
                padding: '1.5rem',
              }}
            >
              <h3
                style={{
                  fontSize: '1.125rem',
                  fontWeight: 600,
                  color: 'var(--foreground)',
                  marginBottom: '0.5rem',
                }}
              >
                {feature.title}
              </h3>
              <p
                style={{
                  fontSize: '0.875rem',
                  color: 'var(--text-muted)',
                  lineHeight: 1.5,
                }}
              >
                {feature.description}
              </p>
            </div>
          ))}
        </div>

        <footer
          style={{
            marginTop: '4rem',
            paddingTop: '2rem',
            borderTop: '1px solid var(--card-border)',
            fontSize: '0.875rem',
            color: 'var(--text-muted)',
          }}
        >
          Development Environment Operational
        </footer>
      </div>
    </main>
  );
}
