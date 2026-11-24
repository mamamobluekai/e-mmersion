import AuthForm from '../../components/auth/AuthForm';
import './LoginAndFRegister.css';

function LoginAndFRegister({ onAuthSuccess, initialRole, allowRoleSwitch }) {
  return <AuthForm onAuthSuccess={onAuthSuccess} initialRole={initialRole} allowRoleSwitch={allowRoleSwitch} />;
}

export default LoginAndFRegister;
