import { useState, useEffect } from 'react';

export function App() {
  const [token, setToken] = useState(() => localStorage.getItem('token'));
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  async function handleLogin() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user: 'test', pass: 'test' }),
      });
      if (!res.ok) {
        throw new Error(`Login failed: ${res.status}`);
      }
      const json = await res.json();
      localStorage.setItem('token', json.token);
      setToken(json.token);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function fetchData() {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/data', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.status === 401) {
        localStorage.removeItem('token');
        setToken(null);
        setError('Session expired');
        return;
      }
      if (!res.ok) {
        throw new Error(`Request failed: ${res.status}`);
      }
      const json = await res.json();
      setData(json);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  function handleLogout() {
    localStorage.removeItem('token');
    setToken(null);
    setData(null);
    setError(null);
  }

  useEffect(() => {
    if (token) fetchData();
  }, [token]);

  if (!token) {
    return (
      <div id="login-form">
        <h1>Grove Smoke Test</h1>
        <button onClick={handleLogin} disabled={loading}>
          {loading ? 'Logging in...' : 'Login'}
        </button>
        {error && <p className="error" style={{ color: 'red' }}>{error}</p>}
      </div>
    );
  }

  return (
    <div id="dashboard">
      <h1>Grove Smoke Test</h1>
      <button onClick={handleLogout}>Logout</button>
      <button onClick={fetchData} disabled={loading}>Refresh</button>
      {loading && <p>Loading...</p>}
      {error && <p className="error" style={{ color: 'red' }}>{error}</p>}
      {data && <pre id="data-display">{JSON.stringify(data, null, 2)}</pre>}
    </div>
  );
}
