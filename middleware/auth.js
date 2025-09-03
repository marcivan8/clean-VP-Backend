const { supabaseAdmin } = require('../config/database');

const authenticateUser = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      console.error('No valid authorization header');
      return res.status(401).json({ 
        error: 'No valid authorization header',
        code: 'MISSING_AUTH_HEADER' 
      });
    }

    const token = authHeader.replace('Bearer ', '');
    
    if (!token || token === 'null' || token === 'undefined') {
      console.error('Invalid token provided');
      return res.status(401).json({ 
        error: 'Invalid token provided',
        code: 'INVALID_TOKEN'
      });
    }
    
    // Utiliser getUser avec le token pour valider
    const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);

    if (error) {
      console.error('Token validation error:', error);
      return res.status(401).json({ 
        error: 'Invalid or expired token',
        code: 'TOKEN_VALIDATION_FAILED',
        details: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }

    if (!user || !user.id) {
      console.error('No user returned from token validation');
      return res.status(401).json({ 
        error: 'Invalid or expired token',
        code: 'NO_USER_FROM_TOKEN' 
      });
    }

    // Vérifier que l'utilisateur existe dans notre DB profiles
    const { data: profile, error: profileError } = await supabaseAdmin
      .from('profiles')
      .select('*')
      .eq('id', user.id)
      .single();

    if (profileError) {
      console.error('Profile fetch error:', profileError);
      
      // Si le profil n'existe pas (PGRST116), retourner une erreur spécifique
      if (profileError.code === 'PGRST116') {
        return res.status(404).json({ 
          error: 'User profile not found. Please complete your registration.',
          code: 'PROFILE_NOT_FOUND'
        });
      }
      
      return res.status(500).json({ 
        error: 'Failed to fetch user profile',
        code: 'PROFILE_FETCH_ERROR'
      });
    }

    if (!profile) {
      console.error('No profile found for user:', user.id);
      return res.status(404).json({ 
        error: 'User profile not found',
        code: 'PROFILE_MISSING'
      });
    }

    // Attacher user et profile à la requête
    req.user = { 
      ...user, 
      profile: profile,
      // Ensure we have the user ID accessible
      id: user.id
    };
    
    console.log(`✅ User authenticated: ${user.id} (${user.email})`);
    next();
  } catch (error) {
    console.error('Auth middleware error:', error);
    res.status(500).json({ 
      error: 'Authentication failed',
      code: 'AUTH_MIDDLEWARE_ERROR',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

const optionalAuth = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      req.user = null;
      return next();
    }

    const token = authHeader.replace('Bearer ', '');
    
    if (!token || token === 'null' || token === 'undefined') {
      req.user = null;
      return next();
    }

    const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);

    if (error || !user) {
      req.user = null;
      return next();
    }

    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('*')
      .eq('id', user.id)
      .single();

    req.user = profile ? { ...user, profile, id: user.id } : null;
    next();
  } catch (error) {
    console.error('Optional auth error:', error);
    req.user = null;
    next();
  }
};

module.exports = { authenticateUser, optionalAuth };