import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import SignUp from '../components/Auth/SignUp';
import { useAuth } from '../context/AuthContext';

type SignUpStep = 'create' | 'confirm';

export default function SignUpPage() {
	const navigate = useNavigate();
	const { signUp, confirmSignUp } = useAuth();

	const [step, setStep] = useState<SignUpStep>('create');
	const [pendingEmail, setPendingEmail] = useState('');
	const [code, setCode] = useState('');
	const [status, setStatus] = useState('');
	const [isLoading, setIsLoading] = useState(false);

	const handleSignUp = async (payload: { email: string; password: string; firstName: string; lastName: string }) => {
		setIsLoading(true);

		try {
			await signUp(payload);
			setPendingEmail(payload.email);
			setStatus('');
			setStep('confirm');
		} catch (error) {
			setStatus(`Error: ${String(error)}`);
		} finally {
			setIsLoading(false);
		}
	};

	const handleConfirm = async () => {
		if (!code.trim()) {
			setStatus('Please enter the verification code.');
			return;
		}

		setIsLoading(true);

		try {
			await confirmSignUp(pendingEmail, code);
			setStatus('Email verified successfully. Redirecting to login...');
			setTimeout(() => navigate('/login'), 800);
		} catch (error) {
			setStatus(`Error: ${String(error)}`);
		} finally {
			setIsLoading(false);
		}
	};

	return (
		<main className="signup-page">
			<section className="signup-shell">
				<aside className="signup-info-panel">
					<div className="signup-info-content">
						<p className="signup-kicker">EcoLens Platform</p>

						<h1>Secure wildlife media management</h1>

						<p className="signup-info-description">
							Create an account to access the EcoLens platform for uploading, organising,
							searching and managing wildlife media records through a protected cloud workflow.
						</p>

						<div className="signup-feature-list">
							<div className="signup-feature-item">
								<span>01</span>
								<p>Secure authentication for protected upload and search features.</p>
							</div>

							<div className="signup-feature-item">
								<span>02</span>
								<p>Cloud-based media processing for images, videos and thumbnails.</p>
							</div>

							<div className="signup-feature-item">
								<span>03</span>
								<p>Structured species tags and metadata for faster media discovery.</p>
							</div>
						</div>
					</div>
				</aside>

				<section className="signup-form-panel">
					<div className="signup-form-heading">
						<p className="signup-kicker form">Account setup</p>
						<h2>Create your account</h2>
						<p>Complete the details below to begin using EcoLens.</p>
					</div>

					<div className="signup-progress">
						<div className={`signup-progress-step ${step === 'create' ? 'active' : 'done'}`}>
							<div className="signup-progress-number">1</div>
							<div className="signup-progress-label">Account details</div>
						</div>

						<div className="signup-progress-line" />

						<div className={`signup-progress-step ${step === 'confirm' ? 'active' : ''}`}>
							<div className="signup-progress-number">2</div>
							<div className="signup-progress-label">Email verification</div>
						</div>
					</div>

					{step === 'create' && (
						<div className="signup-card-professional">
							<SignUp onSubmit={handleSignUp} />
						</div>
					)}

					{step === 'confirm' && (
						<div className="signup-card-professional">
							<div className="signup-card-header">
								<h3>Verify your email</h3>
								<p>
									A verification code has been sent to <strong>{pendingEmail}</strong>.
									Enter the code below to complete registration.
								</p>
							</div>

							<div className="signup-field-group">
								<label htmlFor="confirm-code">Verification code</label>
								<input
									id="confirm-code"
									type="text"
									value={code}
									onChange={(event) => setCode(event.target.value)}
									placeholder="Enter verification code"
									autoFocus
								/>
							</div>

							<div className="signup-button-row">
								<button
									className="signup-primary-button"
									type="button"
									onClick={handleConfirm}
									disabled={isLoading}
								>
									{isLoading ? 'Verifying...' : 'Verify account'}
								</button>

								<button
									className="signup-secondary-button"
									type="button"
									disabled={isLoading}
									onClick={() => {
										setStep('create');
										setCode('');
										setStatus('');
									}}
								>
									Back
								</button>
							</div>
						</div>
					)}

					{status && (
						<p className={`signup-status ${status.startsWith('Error') ? 'error' : 'success'}`}>
							{status}
						</p>
					)}

					<div className="signup-footer">
						<p>
							Already registered?{' '}
							<button
								className="signup-link-button"
								type="button"
								onClick={() => navigate('/login')}
							>
								Sign in
							</button>
						</p>
					</div>
				</section>
			</section>
		</main>
	);
}