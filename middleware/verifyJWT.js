const jwt = require("jsonwebtoken");

const verifyJWT = (req, res, next) => {
  const authorization = req.headers.authorization;

  if (!authorization) {
    return res
      .status(401)
      .send({ error: true, message: "Unauthorized Access" });
  }

  const token = authorization.split(" ")[1];

  jwt.verify(token, process.env.JWT_SECRET_KEY, (err, decoded) => {
    if (err) {
      return res.status(401).send({ error: true, message: err.message });
    }
    req.decoded = decoded;
    next();
  });
};

module.exports = { verifyJWT };
