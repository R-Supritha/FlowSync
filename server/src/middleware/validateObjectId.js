const mongoose = require('mongoose');

// validateObjectId('id', 'milestoneId') -> 400 if any named route param is not a valid ObjectId
function validateObjectId(...paramNames) {
  return (req, res, next) => {
    for (const name of paramNames) {
      if (!mongoose.isValidObjectId(req.params[name])) {
        return res.status(400).json({ success: false, message: `Invalid ${name}` });
      }
    }
    next();
  };
}

module.exports = validateObjectId;
