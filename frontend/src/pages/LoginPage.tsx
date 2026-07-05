import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Login from '../components/Auth/Login';
import { useAuth } from '../context/AuthContext';

export default function LoginPage() {
	const navigate = useNavigate();
	const { signIn } = useAuth();

	const [status, setStatus] = useState('');

	const handleLogin = async (payload: { email: string; password: string }) => {
		try {
			setStatus('');
			await signIn(payload.email, payload.password);
			navigate('/dashboard');
		} catch (error) {
			setStatus(`Error: ${String(error)}`);
		}
	};

	return (
		<main className="login-page">
			<section className="login-shell">
				<aside className="login-info-panel">
					<div className="login-info-content">
						<p className="login-kicker">EcoLens Platform</p>

						<h1>Access your wildlife media workspace</h1>

						<p className="login-info-description">
							Sign in to manage wildlife media, review uploaded records, search species
							data and continue using the EcoLens platform through a secure cloud-based
							workflow.
						</p>

						<div className="login-feature-list">
							<div className="login-feature-item">
								<span>01</span>
								<p>Secure account access with protected authentication.</p>
							</div>

							<div className="login-feature-item">
								<span>02</span>
								<p>Access uploads, species tags, notifications and media search tools.</p>
							</div>

							<div className="login-feature-item">
								<span>03</span>
								<p>Continue your workflow from a clean and organised dashboard.</p>
							</div>
						</div>
					</div>
				</aside>

				<section className="login-form-panel">
					<div className="login-form-heading">
						<p className="login-kicker form">Account access</p>
						<h2>Welcome back</h2>
						<p>Sign in to access your wildlife media library.</p>
					</div>

					<div className="login-card-professional">
						<Login onSubmit={handleLogin} />
					</div>

					{status && (
						<p className={`login-status ${status.startsWith('Error') ? 'error' : 'success'}`}>
							{status}
						</p>
					)}

					<div className="login-footer">
						<p>
							Don&apos;t have an account?{' '}
							<button
								className="login-link-button"
								type="button"
								onClick={() => navigate('/signup')}
							>
								Create one here
							</button>
						</p>
					</div>
				</section>
			</section>
		</main>
	);
}