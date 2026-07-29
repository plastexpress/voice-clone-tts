import { Navigate, Route, Routes } from "react-router-dom";
import { Layout } from "./components/Layout";
import { Spinner } from "./components/ui";
import { useAuth } from "./store/auth";
import { Dashboard } from "./pages/Dashboard";
import { Login } from "./pages/Login";
import { Playground } from "./pages/Playground";
import { Tokens } from "./pages/Tokens";
import { Voices } from "./pages/Voices";
import { CachePage } from "./pages/Cache";
import { Logs } from "./pages/Logs";
import { SystemPage } from "./pages/System";

export default function App() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-faint">
        <Spinner size={22} />
      </div>
    );
  }

  if (!user) {
    return (
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }

  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/playground" element={<Playground />} />
        <Route path="/tokens" element={<Tokens />} />
        <Route path="/voices" element={<Voices />} />
        <Route path="/cache" element={<CachePage />} />
        <Route path="/logs" element={<Logs />} />
        <Route path="/settings" element={<SystemPage />} />
        <Route path="/login" element={<Navigate to="/" replace />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
  );
}
