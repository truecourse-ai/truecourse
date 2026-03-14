-- Create a separate database for tests so they don't affect development data
CREATE DATABASE truecourse_test;
GRANT ALL PRIVILEGES ON DATABASE truecourse_test TO truecourse;
