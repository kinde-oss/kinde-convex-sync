import './App.css';
import {useQuery} from 'convex/react';
// listUsers is backed by the component's convex-helpers `paginator`, so it must
// be driven by the matching `usePaginatedQuery` from "convex-helpers/react".
// The `convex/react` hook expects app-native pagination and crashes against a
// component-backed paginator query.
import {usePaginatedQuery} from 'convex-helpers/react';
import {api} from '../convex/_generated/api';
import {useState} from 'react';

function UserLookup() {
  const [kindeId, setKindeId] = useState('');
  const [submittedId, setSubmittedId] = useState('');

  const user = useQuery(
    api.example.getUser,
    submittedId ? {kindeId: submittedId} : 'skip'
  );

  return (
    <div className="panel">
      <h2 style={{marginTop: 0}}>🔍 Look Up User by Kinde ID</h2>
      <div style={{display: 'flex', gap: '0.5rem', marginBottom: '1rem'}}>
        <input
          type="text"
          aria-label="Kinde ID"
          value={kindeId}
          onChange={(e) => setKindeId(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && setSubmittedId(kindeId)}
          placeholder="e.g. kp_c3f7ce..."
          style={{
            flex: 1,
            padding: '0.5rem',
            borderRadius: '4px',
            border: '1px solid #ccc'
          }}
        />
        <button
          onClick={() => setSubmittedId(kindeId)}
          style={{padding: '0.5rem 1rem'}}
        >
          Lookup
        </button>
      </div>
      {submittedId && user === null && (
        <div className="empty-state">No user found.</div>
      )}
      {user && (
        <div
          style={{
            textAlign: 'left',
            background: 'rgba(0,0,0,0.05)',
            padding: '1rem',
            borderRadius: '4px'
          }}
        >
          <div>
            <strong>Name:</strong> {user.firstName} {user.lastName}
          </div>
          <div>
            <strong>Email:</strong> {user.email}
          </div>
          <div>
            <strong>Suspended:</strong> {user.isSuspended ? 'Yes' : 'No'}
          </div>
          <div>
            <strong>Orgs:</strong>{' '}
            {user.organizations.length === 0
              ? 'None'
              : user.organizations.map((o) => o.code).join(', ')}
          </div>
          <div>
            <strong>Last synced:</strong>{' '}
            {new Date(user.lastSyncedAt).toLocaleTimeString()}
          </div>
        </div>
      )}
    </div>
  );
}

function UserList() {
  const {
    results: users,
    status,
    loadMore
  } = usePaginatedQuery(api.example.listUsers, {}, {initialNumItems: 100});

  return (
    <div className="panel">
      <h2 style={{marginTop: 0}}>👥 All Synced Users ({users.length})</h2>
      {status !== 'LoadingFirstPage' && users.length === 0 && (
        <div className="empty-state">
          No users synced yet. Create a user in your Kinde dashboard to see them
          appear here instantly.
        </div>
      )}
      <ul style={{listStyle: 'none', padding: 0, textAlign: 'left'}}>
        {users.map((user) => (
          <li
            key={user._id}
            style={{
              marginBottom: '0.5rem',
              padding: '0.75rem',
              background: 'rgba(0,0,0,0.05)',
              borderRadius: '4px'
            }}
          >
            <div>
              <strong>
                {user.firstName} {user.lastName}
              </strong>{' '}
              — {user.email}
            </div>
            <div style={{fontSize: '0.8rem', color: '#888'}}>
              ID: {user.kindeId} · Synced:{' '}
              {new Date(user.lastSyncedAt).toLocaleTimeString()}
            </div>
          </li>
        ))}
      </ul>
      {status === 'CanLoadMore' && (
        <button onClick={() => loadMore(100)} style={{marginTop: '0.5rem'}}>
          Load more
        </button>
      )}
    </div>
  );
}

function App() {
  return (
    <>
      <h1>kinde-sync</h1>
      <p style={{color: '#888', marginBottom: '2rem'}}>
        Real-time Kinde user sync into Convex via webhooks
      </p>
      <div className="card">
        <UserList />
        <UserLookup />
        <p style={{fontSize: '0.8rem', color: '#666'}}>
          Users sync instantly when created, updated, or deleted in Kinde. Point
          your Kinde webhook to <code>/webhooks/kinde</code>.
        </p>
      </div>
    </>
  );
}

export default App;
