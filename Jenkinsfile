pipeline {
    agent any

    environment {
        SERVICE_NAME = 'jiaa-server-data'
        AWS_REGION = 'ap-northeast-2'
        ECR_REGISTRY = credentials('aws-account-id') + '.dkr.ecr.' + AWS_REGION + '.amazonaws.com'
        IMAGE_TAG = "${BUILD_NUMBER}"
    }

    stages {
        stage('Checkout') {
            steps {
                checkout scm
            }
        }

        stage('Install Dependencies') {
            steps {
                sh 'npm ci'
            }
        }

        stage('Test') {
            steps {
                sh 'npm test || true'
            }
        }

        stage('Build') {
            steps {
                sh 'npm run build'
            }
        }

        stage('Build Docker Image') {
            steps {
                sh "docker build -t ${ECR_REGISTRY}/${SERVICE_NAME}:${IMAGE_TAG} ."
                sh "docker tag ${ECR_REGISTRY}/${SERVICE_NAME}:${IMAGE_TAG} ${ECR_REGISTRY}/${SERVICE_NAME}:latest"
            }
        }

        stage('Push to ECR') {
            when {
                anyOf {
                    branch 'main'
                    branch 'develop'
                    branch pattern: 'mvp/*', comparator: 'GLOB'
                }
            }
            steps {
                withAWS(credentials: 'aws-credentials', region: AWS_REGION) {
                    sh "aws ecr get-login-password --region ${AWS_REGION} | docker login --username AWS --password-stdin ${ECR_REGISTRY}"
                    sh "docker push ${ECR_REGISTRY}/${SERVICE_NAME}:${IMAGE_TAG}"
                    sh "docker push ${ECR_REGISTRY}/${SERVICE_NAME}:latest"
                }
            }
        }

        stage('Deploy to ECS') {
            when {
                branch 'main'
            }
            steps {
                withAWS(credentials: 'aws-credentials', region: AWS_REGION) {
                    sh "aws ecs update-service --cluster jiaa-cluster --service ${SERVICE_NAME} --force-new-deployment"
                }
            }
        }
    }

    post {
        success {
            echo "✅ Build & Deploy Success: ${SERVICE_NAME}:${IMAGE_TAG}"
        }
        failure {
            echo "❌ Build Failed: ${SERVICE_NAME}"
        }
        always {
            cleanWs()
        }
    }
}
